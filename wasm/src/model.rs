/* The shapes the archive renders. Deliberately plain: a gallery item is a
path and a name, and the folder is derivable from the path. */

/// One file as the tree listing reports it, with `rel_path` relative to
/// `images/` (so `rack-build/x.jpg`, not `images/rack-build/x.jpg`).
#[derive(Debug, Clone, PartialEq)]
pub struct TreeEntry {
    pub rel_path: String,
    pub sha: String,
    pub size: u64,
}

impl TreeEntry {
    pub fn name(&self) -> String {
        self.rel_path
            .rsplit('/')
            .next()
            .unwrap_or(&self.rel_path)
            .to_string()
    }
}

/// A logical image: one canonical file plus its committed webp/jpeg variants.
#[derive(Debug, Clone)]
pub struct Asset {
    pub folder: String,
    pub canonical: TreeEntry,
    pub variants: Vec<TreeEntry>,
}

impl Asset {
    pub fn name(&self) -> String {
        self.canonical.name()
    }

    /// The name a person reads, without the extension or the hash suffix.
    pub fn pretty_name(&self) -> String {
        let n = self.name();
        match n.rfind('.') {
            Some(i) => n[..i].to_string(),
            None => n,
        }
    }
}

/// One photo on the wall: the asset it came from, plus its day, so the
/// Pictures tab can group without re-reading the tree.
#[derive(Debug, Clone)]
pub struct Picture {
    pub asset: Asset,
    pub day: String,
    pub index: usize,
}

/// A phase, as the Albums tab shows it.
#[derive(Debug, Clone)]
pub struct Album {
    /// The physical folder, which is what the rest of the app keys on.
    pub folder: String,
    /// What a person reads: the journey stage, or the folder name when two
    /// folders share that stage and the stage alone would be ambiguous.
    pub label: String,
    pub cover: Option<Asset>,
    pub count: usize,
}

/// The eight digits of a `YYYYMMDD` at the start of `s`, or None.
fn leading_date(s: &str) -> Option<&str> {
    let d = s.get(..8)?;
    d.chars().all(|c| c.is_ascii_digit()).then_some(d)
}

/// A photo-camera filename gives the day outright: `20260621_122750`.
/// A WhatsApp one carries it in the name: `IMG-20260621-WA0001`.
pub fn photo_day(name: &str) -> Option<String> {
    let iso8 = leading_date(name).or_else(|| {
        name.strip_prefix("IMG-")
            .or_else(|| name.strip_prefix("img-"))
            .and_then(leading_date)
    })?;
    Some(format!("{}-{}-{}", &iso8[..4], &iso8[4..6], &iso8[6..8]))
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Days since 1970-01-01 for a proleptic Gregorian date.
///
/// Howard Hinnant's `days_from_civil`: shift the year so it starts in March,
/// which puts the leap day at the end of the year where it cannot shift the
/// month boundaries. Exact for any year, no lookup tables, no panics — and it
/// runs natively, so the day labels are covered by `cargo test` rather than
/// only in a browser.
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // 0..399
    let mp = ((m as i64) + 9) % 12; // March = 0
    let doy = (153 * mp + 2) / 5 + d as i64 - 1; // 0..365
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // 0..146096
    era * 146_097 + doe - 719_468
}

/// The weekday index, 0 = Sunday.
fn weekday_index(y: i32, m: u32, d: u32) -> usize {
    // 1970-01-01 was a Thursday, which is index 4.
    (days_from_civil(y, m, d) + 4).rem_euclid(7) as usize
}

/// `2026-06-21` → `Sun, 21 Jun`, with the year added when it is not this one.
pub fn fmt_day(iso: &str, this_year: i32) -> String {
    let p: Vec<&str> = iso.split('-').collect();
    if p.len() != 3 {
        return iso.to_string();
    }
    let (Ok(y), Ok(m), Ok(d)) = (
        p[0].parse::<i32>(),
        p[1].parse::<u32>(),
        p[2].parse::<u32>(),
    ) else {
        return iso.to_string();
    };
    if !(1..=12).contains(&m) || d == 0 || d > 31 {
        return iso.to_string();
    }
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let weekday = DAYS[weekday_index(y, m, d)];
    let month = MONTHS[(m as usize - 1).min(11)];
    if y == this_year {
        format!("{weekday}, {d} {month}")
    } else {
        format!("{weekday}, {d} {month} {y}")
    }
}
