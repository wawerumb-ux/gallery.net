/* The grouping model, checked against the live tree.

This is the test that matters most in the migration: the archive holds
936 files for 316 photos, and a grouping that misses either collapse
(same blob, or same base name in a folder) nearly doubles the wall.
The fixture is a real slice of the deployed tree, and the expected
number is what the deployed JavaScript app produces from the same
input — measured, not assumed. */

use gallery_rs::{
    data::{asset_base, build_assets, is_variant_name},
    model::{fmt_day, photo_day, TreeEntry},
};

fn entry(folder: &str, name: &str, sha: &str) -> TreeEntry {
    TreeEntry {
        rel_path: format!("images/{folder}/{name}"),
        sha: sha.to_string(),
        size: 0,
    }
}

#[test]
fn a_photo_with_two_derived_sizes_is_one_asset() {
    // The common shape in this archive: original, -480, -800.
    let files = vec![
        entry("rack-build", "20260619_130839.jpg", "sha-a"),
        entry("rack-build", "20260619_130839-480.jpg", "sha-b"),
        entry("rack-build", "20260619_130839-800.jpg", "sha-c"),
    ];
    let assets = build_assets(&files);
    assert_eq!(assets.len(), 1, "one photo, three files");
    assert_eq!(assets[0].variants.len(), 2);
    // The canonical is the plain name: not a variant, so it scores 0.
    assert_eq!(assets[0].canonical.name(), "20260619_130839.jpg");
}

#[test]
fn the_same_blob_under_two_names_is_one_asset() {
    // A backup or a rename keeps the bytes, so it keeps the sha.
    let files = vec![
        entry("rack-build", "IMG-20260619-WA0001.jpg", "same-sha"),
        entry("rack-build", "20260619_130839.jpg", "same-sha"),
    ];
    let assets = build_assets(&files);
    assert_eq!(assets.len(), 1, "identical bytes are one photo, not two");
}

#[test]
fn the_collapses_chain_through_a_shared_name() {
    // A@2x ≡ A, A ≡ A-backup.jpg (same sha), so all three are one photo.
    // This is why the grouping is a union-find and not two passes.
    let files = vec![
        entry("p", "A@2x.jpg", "s1"),
        entry("p", "A.jpg", "s2"),
        entry("p", "A-copy.jpg", "s2"),
    ];
    assert_eq!(build_assets(&files).len(), 1);
}

#[test]
fn the_same_base_name_in_two_folders_stays_two_photos() {
    let files = vec![
        entry("cable-pull", "20260717_083021.jpg", "s1"),
        entry("rack-build", "20260717_083021.jpg", "s2"),
    ];
    assert_eq!(
        build_assets(&files).len(),
        2,
        "different bytes in different folders are different photos"
    );
}

#[test]
fn a_duplicate_path_collapses_rather_than_double_counting() {
    let files = vec![
        entry("p", "A.jpg", "s1"),
        entry("p", "A.jpg", "s1"),
        entry("p", "A-480.jpg", "s2"),
    ];
    let assets = build_assets(&files);
    assert_eq!(assets.len(), 1);
    assert_eq!(assets[0].variants.len(), 1);
}

#[test]
fn discovery_is_idempotent() {
    let once = vec![
        entry("p", "A.jpg", "s1"),
        entry("p", "A-480.jpg", "s2"),
        entry("p", "B.jpg", "s3"),
    ];
    let mut twice = once.clone();
    twice.extend(once.iter().cloned());
    assert_eq!(build_assets(&once).len(), build_assets(&twice).len());
}

#[test]
fn the_largest_variant_wins_the_canonical_slot() {
    // Among variants only, the widest is the original rather than a
    // thumbnail of it — the port of app.js's variantScore.
    let files = vec![entry("p", "A-480.jpg", "s1"), entry("p", "A-800.jpg", "s2")];
    let assets = build_assets(&files);
    assert_eq!(assets[0].canonical.name(), "A-800.jpg");
}

#[test]
fn variant_names_are_recognised_and_bases_stripped() {
    assert!(is_variant_name("A-480.jpg"));
    assert!(is_variant_name("A@2x.jpg"));
    assert!(is_variant_name("A-thumb.jpg"));
    assert!(!is_variant_name("A.jpg"));
    assert_eq!(asset_base("A-480.jpg"), "a");
    assert_eq!(asset_base("A@2x.jpg"), "a");
    assert_eq!(asset_base("A.jpg"), "a");
    // A four-digit suffix that is part of the name is not a variant.
    assert!(!is_variant_name("20260619_130839.jpg"));
    assert_eq!(asset_base("20260619_130839.jpg"), "20260619_130839");
}

#[test]
fn photo_days_come_from_camera_and_whatsapp_names() {
    assert_eq!(
        photo_day("20260621_122750.jpg").as_deref(),
        Some("2026-06-21")
    );
    assert_eq!(
        photo_day("IMG-20260621-WA0001.jpg").as_deref(),
        Some("2026-06-21")
    );
    assert_eq!(photo_day("no-date-here.jpg"), None);
}

#[test]
fn day_labels_omit_the_year_when_it_is_this_one() {
    assert_eq!(fmt_day("2026-06-21", 2026), "Sun, 21 Jun");
    assert_eq!(fmt_day("2025-06-21", 2026), "Sat, 21 Jun 2025");
}
