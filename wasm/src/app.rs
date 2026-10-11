/* The Pictures wall and the Albums grid, in Leptos signals.

This is the proof of concept's whole surface: read the repo tree, group it
by day (Pictures) or by phase (Albums), move between the two tabs, and
open a photo. It carries the same DOM hooks as the existing markup —
`.card`, `.album`, `#picturesView`, `#albumsView`, `#tabbar`, `#lightbox` —
so the One UI stylesheet applies without edits. */

use leptos::*;
use std::collections::BTreeMap;
use std::sync::Arc;
use wasm_bindgen::JsCast;

// `Memo` and `RwSignal` have no inherent get/set — they implement these
// traits, which therefore have to be in scope for the reactive reads below.
use leptos::{SignalGet, SignalWith};

use gallery_rs::data::{album_stage_name, build_assets, images_tree, page_url};
use gallery_rs::model::{fmt_day, photo_day, Album, Asset, Picture, TreeEntry};

/// Everything the view needs. One struct, handed to each component.
///
/// It is `Copy` because every field is an `RwSignal` (a handle, not the
/// value) — which is also what lets it be passed straight into `view!`
/// children, where the macro needs an `Fn` closure rather than one that
/// moves state out. There are no globals anywhere in the module.
/// One day heading and the photos under it, newest day first.
type DayRun = (String, Vec<Picture>);

#[derive(Clone, Copy)]
pub struct Archive {
    pub loading: RwSignal<bool>,
    pub tab: RwSignal<Tab>,
    /// Pictures grouped into day runs. Shared, not copied: each `Picture`
    /// owns an `Asset` with a path and a name in it, and 316 of those is a
    /// lot of allocation to hand to a memo on every keystroke.
    pub days: RwSignal<Arc<Vec<DayRun>>>,
    pub albums: RwSignal<Arc<Vec<Album>>>,
    pub total_photos: RwSignal<usize>,
    /// The open viewer: an index into the flat picture list.
    pub viewer: RwSignal<Option<usize>>,
    pub flat: RwSignal<Arc<Vec<Picture>>>,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Tab {
    Pictures,
    Albums,
}

#[component]
pub fn App() -> impl IntoView {
    let archive = Archive {
        loading: RwSignal::new(true),
        tab: RwSignal::new(Tab::Pictures),
        days: RwSignal::new(Arc::new(Vec::new())),
        albums: RwSignal::new(Arc::new(Vec::new())),
        total_photos: RwSignal::new(0),
        viewer: RwSignal::new(None),
        flat: RwSignal::new(Arc::new(Vec::new())),
    };

    load_tree(archive);

    view! { <Shell archive/> }
}

fn load_tree(archive: Archive) {
    spawn_local(async move {
        let entries = match images_tree().await {
            Ok(e) => e,
            Err(msg) => {
                // Surface it rather than showing an empty archive that looks
                // like the gallery simply has no photos in it.
                web_sys::console::error_1(&format!("images_tree failed: {msg}").into());
                archive.loading.set(false);
                return;
            }
        };
        web_sys::console::log_1(&format!("images_tree: {} files", entries.len()).into());
        let assets: Vec<Asset> = build_assets(&entries);
        let this_year = current_year();

        // Pictures: newest day first, each carrying its own index so the
        // viewer walks exactly this order.
        let mut pictures: Vec<Picture> = assets
            .into_iter()
            .enumerate()
            .map(|(i, asset)| {
                let day = photo_day(&asset.name()).unwrap_or_default();
                Picture {
                    asset,
                    day,
                    index: i,
                }
            })
            .collect();
        pictures.sort_by(|a, b| {
            b.day
                .cmp(&a.day)
                .then_with(|| a.asset.name().cmp(&b.asset.name()))
        });

        // Day runs, in the order the sorted list produces.
        let mut days: Vec<(String, Vec<Picture>)> = Vec::new();
        for p in pictures.iter() {
            let key = if p.day.is_empty() {
                "Undated".to_string()
            } else {
                fmt_day(&p.day, this_year)
            };
            match days.last_mut() {
                Some((k, v)) if *k == key => v.push(p.clone()),
                _ => days.push((key, vec![p.clone()])),
            }
        }

        // Albums: one per folder, labelled by its journey stage where that is
        // unambiguous. Nine physical folders, eight albums — the app counts
        // the same way, and this is the difference that told me the grouping
        // was wrong when I first read 9.
        let mut by_folder: BTreeMap<String, Vec<Asset>> = BTreeMap::new();
        for p in pictures.iter() {
            if p.asset.folder.is_empty() {
                continue;
            }
            by_folder
                .entry(p.asset.folder.clone())
                .or_default()
                .push(p.asset.clone());
        }
        let folder_names: Vec<String> = by_folder.keys().cloned().collect();
        let albums: Vec<Album> = by_folder
            .into_iter()
            .map(|(folder, list)| {
                let count = list.len();
                let cover = list
                    .iter()
                    .max_by_key(|a| photo_day(&a.name()).unwrap_or_default())
                    .cloned();
                let label = album_stage_name(&folder, &folder_names);
                Album {
                    folder,
                    label,
                    cover,
                    count,
                }
            })
            .collect();

        archive.total_photos.set(pictures.len());
        archive.days.set(Arc::new(days));
        archive.albums.set(Arc::new(albums));
        archive.flat.set(Arc::new(pictures));
        archive.loading.set(false);
    });
}

fn current_year() -> i32 {
    js_sys::Date::new_0().get_full_year() as i32
}

#[component]
fn Shell(archive: Archive) -> impl IntoView {
    // `Archive` is Copy — every field is a signal handle — so each closure
    // can take its own copy without an explicit clone.
    let heading = create_memo(move |_| {
        let total = archive.total_photos.get();
        let albums = archive.albums.with(|a| a.len());
        format!(
            "Structured cabling archive — {} photo{} · {} album{}",
            total,
            if total == 1 { "" } else { "s" },
            albums,
            if albums == 1 { "" } else { "s" },
        )
    });

    view! {
        <div class="app" id="app">
            <header class="appbar-hero" id="appbar">
                <h1 class="appbar-title">"Gallery"</h1>
                <p class="appbar-sub" id="appbarSub">{move || heading.get()}</p>

            </header>

            <main class="wall" id="wall">
                <Show
                    when=move || !archive.loading.get()
                    fallback=|| view! { <LoadingState/> }
                >
                    <PicturesView archive=archive/>
                    <AlbumsView archive=archive/>
                </Show>
            </main>

            <TabBar archive=archive/>
            <Viewer archive=archive/>
        </div>
    }
}

#[component]
fn LoadingState() -> impl IntoView {
    view! {
        <div class="loading" id="loadingState">
            <p class="loading-caption">"Loading the archive…"</p>
        </div>
    }
}

/// One day run: a heading and its photos, in the CSS grid the stylesheet
/// already lays out.
#[component]
fn PicturesView(archive: Archive) -> impl IntoView {
    let days = archive.days.get().as_ref().clone();
    view! {
        <section id="picturesView" aria-label="Pictures" class="dayruns">
            {days
                .into_iter()
                .map(|(day, pics)| {
                    view! {
                        <div class="dayrun" data-day=day.clone()>
                            <h2 class="day-head">
                                {day.clone()}
                                <span class="day-count">{format!(" {}", pics.len())}</span>
                            </h2>
                            <div class="grid-pictures">
                                {pics
                                    .into_iter()
                                    .map(|p| { view! { <Card picture=p archive=archive/> } })
                                    .collect_view()}
                            </div>
                        </div>
                    }
                })
                .collect_view()}
        </section>
    }
}

#[component]
fn Card(picture: Picture, archive: Archive) -> impl IntoView {
    let idx = picture.index;
    let name = picture.asset.pretty_name();
    let label = format!("Open {name}");
    let src = thumb_src(&picture.asset);
    let full = full_src(&picture.asset);

    // The loaded flag is a signal, not a class poked straight onto the node:
    // Leptos owns a reactive `class` attribute and re-applies it on every
    // render, so a direct classList.add is silently undone and the photo stays
    // blurred forever (`.card img:not(.is-loaded)` in style.css).
    let loaded = RwSignal::new(false);

    view! {
        <button
            class="card"
            type="button"
            data-path=picture.asset.canonical.rel_path.clone()
            aria-label=label
            on:click=move |_| archive.viewer.set(Some(idx))
        >
            <img
                class=move || if loaded.get() { "card-img is-loaded" } else { "card-img" }
                src=src
                alt=name
                loading="lazy"
                decoding="async"
                width="400"
                height="300"
                on:load=move |e: web_sys::Event| {
                    // Reveal the moment the tiny thumb finishes — never gate the
                    // blur-clear on the heavier sharp tier, which upgrades in
                    // the background. On a 1x screen the two are one file.
                    loaded.set(true);
                    if let (Some(img), Some(full)) = (
                        e.target().and_then(|t| t.dyn_into::<web_sys::HtmlImageElement>().ok()),
                        full.as_ref(),
                    ) {
                        let current = img.get_attribute("src").unwrap_or_default();
                        if !current.ends_with(full.as_str()) && !current.is_empty() {
                            img.set_src(full);
                        }
                    }
                }
            />
        </button>
    }
}

#[component]
fn AlbumsView(archive: Archive) -> impl IntoView {
    let on_albums = create_memo(move |_| archive.tab.get() == Tab::Albums);
    let albums = archive.albums.get().as_ref().clone();
    view! {
        <section
            id="albumsView"
            aria-label="Albums"
            class="albums-view"
            hidden=move || !on_albums.get()
        >
            <div class="grid-albums">
                {albums
                    .into_iter()
                    .map(|a| {
                        let cover = a
                            .cover
                            .as_ref()
                            .map(|c| page_url(&c.canonical.rel_path))
                            .unwrap_or_default();
                        let count = format!(
                            "{} photo{}",
                            a.count,
                            if a.count == 1 { "" } else { "s" }
                        );
                        view! {
                            <AlbumTile
                                folder=a.folder.clone()
                                label=a.label.clone()
                                cover=cover
                                count=count
                            />
                        }
                    })
                    .collect_view()}
            </div>
        </section>
    }
}

/// One album. Its cover is an image, so it takes the same blur-up treatment as
/// a card — style.css blurs `.album-cover img` without `is-loaded` too.
#[component]
fn AlbumTile(folder: String, label: String, cover: String, count: String) -> impl IntoView {
    // Same reasoning as Card: the flag has to be reactive, or Leptos re-applies
    // the plain class on the next render and the cover stays blurred.
    let loaded = RwSignal::new(false);
    view! {
        <article class="album" data-folder=folder.clone()>
            <img
                class=move || if loaded.get() { "album-cover is-loaded" } else { "album-cover" }
                src=cover
                alt=folder.clone()
                loading="lazy"
                decoding="async"
                on:load=move |_| loaded.set(true)
            />
            <div class="album-meta">
                <span class="album-name">{label}</span>
                <span class="album-count">{count}</span>
            </div>
        </article>
    }
}

#[component]
fn TabBar(archive: Archive) -> impl IntoView {
    let on_pictures = create_memo(move |_| archive.tab.get() == Tab::Pictures);
    let on_albums = create_memo(move |_| archive.tab.get() == Tab::Albums);
    view! {
        <nav class="tabbar" id="tabbar" aria-label="Gallery views">
            <button
                class="tab"
                type="button"
                data-view="pictures"
                aria-current=move || if on_pictures.get() { "page" } else { "false" }
                on:click=move |_| archive.tab.set(Tab::Pictures)
            >
                <span class="tab-ic" aria-hidden="true">"▣"</span>
                <span class="tab-label">"Pictures"</span>
            </button>
            <button
                class="tab"
                type="button"
                data-view="phases"
                aria-current=move || if on_albums.get() { "page" } else { "false" }
                on:click=move |_| archive.tab.set(Tab::Albums)
            >
                <span class="tab-ic" aria-hidden="true">"▢"</span>
                <span class="tab-label">"Albums"</span>
            </button>
        </nav>
    }
}

/// The fullscreen viewer: opens on a card, closes on Escape or the dismiss
/// glyph, and steps with the arrow keys.
#[component]
fn Viewer(archive: Archive) -> impl IntoView {
    let viewer = archive.viewer;

    // Reads the one picture the viewer is showing. `with` borrows the shared
    // list rather than cloning 316 assets out of it on every arrow key — that
    // clone is what made stepping the viewer take seconds.
    let current = create_memo(move |_| {
        viewer.with(|v| {
            let i = (*v)?;
            let flat = archive.flat.get();
            let p = flat.get(i)?;
            Some((
                page_url(&p.asset.canonical.rel_path),
                p.asset.pretty_name(),
                p.day.clone(),
            ))
        })
    });
    // A memo is a value, not a getter — read it once per reactive site.
    let current_src = move || current.get().map(|c| c.0);
    let current_name = move || current.get().map(|c| c.1);
    let current_day = move || current.get().map(|c| c.2);

    let step = move |delta: i32| {
        let n = archive.flat.with(|f| f.len());
        if n == 0 {
            return;
        }
        viewer.update(|v| {
            if let Some(i) = *v {
                *v = Some((i as i32 + delta).rem_euclid(n as i32) as usize);
            }
        });
    };

    // The typed listener helper wants an event descriptor; this is the
    // untyped form, which takes the name and gives back the raw event.
    // Registered once for the lifetime of the page, as the previous
    // document-level keydown handler was.
    window_event_listener_untyped("keydown", move |e: web_sys::Event| {
        if viewer.get_untracked().is_none() {
            return;
        }
        let e: web_sys::KeyboardEvent = e.dyn_into().expect("keydown is a KeyboardEvent");
        match e.key().as_str() {
            "Escape" => viewer.set(None),
            "ArrowLeft" => step(-1),
            "ArrowRight" => step(1),
            _ => {}
        }
    });

    let open = move || viewer.get().is_some();

    view! {
        <div
            id="lightbox"
            class="viewer"
            hidden=move || !open()
            aria-modal="true"
            role="dialog"
            aria-label="Photo viewer"
        >
            <div class="viewer-top">
                <button
                    class="viewer-icon"
                    type="button"
                    aria-label="Close viewer"
                    on:click=move |_| viewer.set(None)
                >
                    "×"
                </button>
                <span class="viewer-title">
                    {move || current_name().unwrap_or_default()}
                </span>
                <a class="viewer-icon" href=move || current_src().unwrap_or_default() download="photo">
                    "↓"
                </a>
            </div>
            <div class="viewer-viewport" id="lightboxViewport">
                <button
                    class="viewer-nav viewer-prev"
                    type="button"
                    aria-label="Previous photo"
                    on:click=move |_| step(-1)
                >
                    "‹"
                </button>
                <Show
                    when=move || current_src().is_some()
                    fallback=|| view! { <span class="viewer-slide"/> }
                >
                    <img
                        id="lightboxImg"
                        class="viewer-img"
                        src=move || current_src().unwrap_or_default()
                        alt=move || current_name().unwrap_or_default()
                    />
                </Show>
                <button
                    class="viewer-nav viewer-next"
                    type="button"
                    aria-label="Next photo"
                    on:click=move |_| step(1)
                >
                    "›"
                </button>
            </div>
            <div class="viewer-bottom">
                <span class="viewer-name">
                    {move || current_name().unwrap_or_default()}
                </span>
                <span class="viewer-meta">
                    {move || current_day().unwrap_or_default()}
                </span>
            </div>
        </div>
    }
}

/// Blur-up thumbnails come from the jsDelivr image CDN exactly as before,
/// preferring a committed small variant when the archive has one.
/// The blur-up source for a card: the smallest committed webp variant, served
/// same-origin from the Pages host.
///
/// Not jsDelivr. app.js tried `cdn.jsdelivr.net/gh/...?w=` first and measured
/// it serving the FULL original (2.7 MB, unresized) while reporting a small
/// width — which put a multi-megabyte download in front of first paint. The
/// committed `-480` webp tier is ~12 KB and comes out of the service worker's
/// image cache on a repeat visit.
fn thumb_src(asset: &Asset) -> String {
    let webps: Vec<&TreeEntry> = asset
        .variants
        .iter()
        .filter(|v| v.rel_path.to_ascii_lowercase().ends_with(".webp"))
        .collect();
    let smallest = webps.iter().min_by_key(|v| v.size).or_else(|| webps.last());
    match smallest {
        Some(v) => page_url(&v.rel_path),
        None => page_url(&asset.canonical.rel_path),
    }
}

/// The sharp tier the card upgrades to once the blur-up has shown: the
/// canonical file itself.
fn full_src(asset: &Asset) -> Option<String> {
    Some(page_url(&asset.canonical.rel_path))
}
