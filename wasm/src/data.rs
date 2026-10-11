/* Data access. Reads the same repo tree the existing app reads, through the
GitHub Contents API — no server, no backend, same static hosting. The
paths and the blob shape are unchanged from app.js. */

use gloo_net::http::Request;

use crate::model::{Asset, TreeEntry};

const API: &str = "https://api.github.com/repos/wawerumb-ux/gallery.net";

/// Fetch the recursive tree under `images/`, returning entries whose paths
/// are relative to that folder — the shape app.js already expects, so the
/// duplicate-collapsing model is unchanged.
pub async fn images_tree() -> Result<Vec<TreeEntry>, String> {
    let url = format!("{API}/git/trees/HEAD?recursive=1");
    let text = Request::get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    // The tree response is large; a tiny hand-rolled pull of just the nodes
    // under images/ keeps the payload small and avoids pulling in serde_json's
    // derive cost for a shape we only read.
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let tree = value
        .get("tree")
        .and_then(|t| t.as_array())
        .ok_or_else(|| "no tree in response".to_string())?;

    let mut out = Vec::new();
    for node in tree {
        let kind = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if kind != "blob" {
            continue;
        }
        let path = match node.get("path").and_then(|v| v.as_str()) {
            Some(p) => p,
            None => continue,
        };
        let rest = match path.strip_prefix("images/") {
            Some(r) => r,
            None => continue,
        };
        if !is_image(rest) {
            continue;
        }
        out.push(TreeEntry {
            rel_path: rest.to_string(),
            sha: node
                .get("sha")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            size: node.get("size").and_then(|v| v.as_u64()).unwrap_or(0),
        });
    }
    Ok(out)
}

/* The duplicate model, kept faithful to app.js: a file's stem is its base
name without the extension, and a variant suffix on that stem marks a
derived copy of the same photo. */

fn is_image(path: &str) -> bool {
    let p = path.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]
        .iter()
        .any(|e| p.ends_with(e))
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// `rack-front_1024.jpg` → `rack-front`
pub fn basename_stem(name: &str) -> &str {
    match name.rfind('.') {
        Some(i) => &name[..i],
        None => name,
    }
}

/// The length of the variant suffix at the end of `stem`, or 0 for none.
///
/// This is app.js's `VARIANT_REGEX` — `/(@\d+x|-(\d{3,4}|thumb|thumbnail|sm|md|
/// lg|xl|orig|original|full))$/i` — hand-rolled so the crate needs no regex
/// dependency. It must be this rule and not a list of known sizes: this
/// archive commits `-480` and `-800`, and a list that misses one silently
/// doubles the wall (measured: 628 cards instead of 316). `tests/grouping.rs`
/// pins the shapes.
fn variant_suffix_len(stem: &str) -> usize {
    let lower = stem.to_ascii_lowercase();

    // `@NNNx` — the retina form.
    if let Some(at) = lower.rfind('@') {
        let tail = &lower[at + 1..];
        let digits = tail.strip_suffix('x').unwrap_or("");
        if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
            return tail.len() + 1; // include the '@'
        }
    }

    // The dash forms: a 3-4 digit width, or one of the named sizes.
    const NAMED: [&str; 9] = [
        "thumb",
        "thumbnail",
        "sm",
        "md",
        "lg",
        "xl",
        "orig",
        "original",
        "full",
    ];
    let Some(dash) = lower.rfind('-') else {
        return 0;
    };
    let tail = &lower[dash + 1..];
    let width = (3..=4).contains(&tail.len()) && tail.chars().all(|c| c.is_ascii_digit());
    if width || NAMED.contains(&tail) {
        tail.len() + 1 // include the '-'
    } else {
        0
    }
}

pub fn is_variant_name(name: &str) -> bool {
    variant_suffix_len(basename_stem(name)) > 0
}

/// The identity key: the stem with any variant suffix removed, lowercased.
pub fn asset_base(name: &str) -> String {
    let stem = basename_stem(name).to_ascii_lowercase();
    match variant_suffix_len(&stem) {
        0 => stem,
        n => stem[..stem.len() - n].to_string(),
    }
}

/// Lower rank wins the canonical slot: a non-variant name beats a variant,
/// and among variants the largest pixel width wins, because that is the
/// original rather than a thumbnail of it. Port of app.js `variantScore`.
fn variant_score(name: &str) -> u32 {
    if !is_variant_name(name) {
        return 0;
    }
    let base = basename_stem(name);
    let width = base.rfind('-').and_then(|i| {
        let tail = &base[i + 1..];
        if tail.len() >= 3 && tail.len() <= 4 && tail.chars().all(|c| c.is_ascii_digit()) {
            tail.parse::<u32>().ok()
        } else {
            None
        }
    });
    if let Some(w) = width {
        return 1000 - w;
    }
    5000 + base.len() as u32
}

/// Physical folder → journey sequence. The archive keeps several folders that
/// are the same stage of the work (`rack-build`, `phase-1` and
/// `server-rack-build` are all Rack / Cabinet Installation), and the Albums tab
/// shows the stage, not the folder — which is why the wall has 9 folders and
/// 8 albums. Ported from app.js `FOLDER_STAGES`.
pub const FOLDER_STAGES: [(&str, u32); 10] = [
    ("site-survey", 1),                  // Site Survey & Planning
    ("materials-and-equipments", 2),     // Materials & Equipment
    ("cable-pull", 4),                   // Cable Installation
    ("trunking-installation", 5),        // Cable Routing & Management
    ("rack-build", 6),                   // Rack / Cabinet Installation
    ("phase-1", 6),                      // WhatsApp batch — rack work
    ("server-rack-build", 6),            // rack work, same stage
    ("labelling-and-identification", 9), // Labelling & Identification
    ("termination-testing", 10),         // Testing & Certification
    // Not in the stage table above but present in the archive, and mapped to
    // the survey stage like app.js does:
    ("site-survey-map", 1),
];

/// The journey the archive walks, in order. Ported from app.js `JOURNEY`.
pub const JOURNEY: [(&str, u32); 12] = [
    ("Site Survey & Planning", 1),
    ("Materials & Equipment", 2),
    ("Pathways & Containment", 3),
    ("Cable Installation", 4),
    ("Cable Routing & Management", 5),
    ("Rack / Cabinet Installation", 6),
    ("Patch Panels & Termination", 7),
    ("Outlet / Faceplate Installation", 8),
    ("Labelling & Identification", 9),
    ("Testing & Certification", 10),
    ("Network Integration", 11),
    ("Final Inspection & Handover", 12),
];

/// The stage a physical folder belongs to, or None when it is not in the
/// table.
pub fn journey_for(folder: &str) -> Option<&'static str> {
    let seq = FOLDER_STAGES
        .iter()
        .find(|(f, _)| *f == folder)
        .map(|(_, s)| *s)?;
    JOURNEY
        .iter()
        .find(|(_, s)| *s == seq)
        .map(|(name, _)| *name)
}

/// The label an album presents to a person: the stage, unless two folders in
/// this archive share that stage — then the folder name, because the stage
/// would be ambiguous. That is app.js `albumStageName`.
pub fn album_stage_name(folder: &str, all_folders: &[String]) -> String {
    let Some(stage) = journey_for(folder) else {
        return folder.to_string();
    };
    let clashes = all_folders
        .iter()
        .filter(|f| *f != folder && journey_for(f) == Some(stage))
        .count();
    if clashes > 0 {
        folder.to_string()
    } else {
        stage.to_string()
    }
}

/// Group a flat file list into logical assets: one canonical file per
/// distinct photo, with its derived variants attached.
///
/// This is the same union-find app.js uses, and it has to be: the archive
/// holds 936 files for 316 photos, and a grouping that misses either rule
/// nearly doubles the wall.
///
/// A file is unioned with (a) every file of the same blob — a renamed copy
/// or backup is the same photo — and (b) every file in the same folder
/// sharing a base name — `-thumb`, `@2x`, `-orig`… are the same photo at
/// other sizes. Those two rules chain, which is why it is a union-find and
/// not two passes: A@2x ≡ A, A ≡ A-backup.jpg, so all three are one photo.
pub fn build_assets(entries: &[TreeEntry]) -> Vec<Asset> {
    // Guard — duplicate API or recursive results collapse to one entry per path.
    let mut by_path: std::collections::HashMap<&str, &TreeEntry> = std::collections::HashMap::new();
    for e in entries {
        by_path.entry(e.rel_path.as_str()).or_insert(e);
    }
    let files: Vec<&TreeEntry> = by_path.into_values().collect();

    let mut uf = UnionFind::new();
    for f in files.iter() {
        let folder = folder_of(&f.rel_path);
        let name = basename(&f.rel_path);
        uf.node(format!("f:{}", f.rel_path));
        uf.node(format!("s:{}", f.sha));
        uf.node(format!("b:{}/{}", folder, asset_base(name)));
        uf.union(&format!("f:{}", f.rel_path), &format!("s:{}", f.sha));
        uf.union(
            &format!("f:{}", f.rel_path),
            &format!("b:{}/{}", folder, asset_base(name)),
        );
    }

    // Group by root, then keep each group's files in discovery-stable order.
    let mut groups: std::collections::HashMap<String, Vec<TreeEntry>> =
        std::collections::HashMap::new();
    for f in files {
        let root = uf.find(&format!("f:{}", f.rel_path));
        groups.entry(root).or_default().push(f.clone());
    }

    let mut out: Vec<Asset> = groups
        .into_values()
        .map(|mut group| {
            group.sort_by(|a, b| {
                let an = basename(&a.rel_path).to_string();
                let bn = basename(&b.rel_path).to_string();
                variant_score(&an)
                    .cmp(&variant_score(&bn))
                    .then_with(|| a.rel_path.cmp(&b.rel_path))
            });
            let canonical = group.remove(0);
            let folder = folder_of(&canonical.rel_path);
            Asset {
                folder,
                canonical,
                variants: group,
            }
        })
        .collect();
    out.sort_by(|a, b| a.canonical.rel_path.cmp(&b.canonical.rel_path));
    out
}

fn folder_of(rel_path: &str) -> String {
    rel_path
        .rsplit_once('/')
        .map(|(d, _)| d.to_string())
        .unwrap_or_default()
}

/// The smallest disjoint-set implementation that does what the grouping
/// needs: path-compressed find and union by first-seen root.
struct UnionFind {
    parent: std::collections::HashMap<String, String>,
}

impl UnionFind {
    fn new() -> Self {
        UnionFind {
            parent: std::collections::HashMap::new(),
        }
    }

    fn node(&mut self, t: String) {
        self.parent.entry(t.clone()).or_insert(t);
    }

    fn find(&mut self, t: &str) -> String {
        let mut root = t.to_string();
        while self.parent.get(&root).map(String::as_str) != Some(root.as_str()) {
            root = self.parent[&root].clone();
        }
        // Path compression, so repeated finds stay cheap.
        let mut cur = t.to_string();
        while cur != root {
            let next = self.parent[&cur].clone();
            self.parent.insert(cur, root.clone());
            cur = next;
        }
        root
    }

    fn union(&mut self, a: &str, b: &str) {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra != rb {
            self.parent.insert(ra, rb);
        }
    }
}

/// Where a file is served from once published: the Pages host, under the
/// /gallery.net/ subpath.
pub fn page_url(rel_path: &str) -> String {
    format!("https://wawerumb-ux.github.io/gallery.net/images/{rel_path}")
}
