/* The Rust entry point. Client-side rendering only: the archive is a static
page with no server behind it, which is what GitHub Pages can host. */

/* The Rust entry point. Client-side rendering only: the archive is a static
page with no server behind it, which is what GitHub Pages can host. */

use leptos::*;

#[path = "app.rs"]
mod app;

fn main() {
    // The shell in index.html exists so the page has something to paint
    // before this module has downloaded and booted; mounting replaces it.
    mount_to_body(app::App);
    if let Some(shell) = document().get_element_by_id("app-shell") {
        shell.remove();
    }
}
