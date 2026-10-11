/* The library half of the crate: the parts of the archive that are pure
functions of the repo tree. They carry no browser types, so the whole
model — the duplicate collapse, the day parsing, the date labels — is
exercised by `cargo test` without a browser. */

#[path = "data.rs"]
pub mod data;
#[path = "model.rs"]
pub mod model;
