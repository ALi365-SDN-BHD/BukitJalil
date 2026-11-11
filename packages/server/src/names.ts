/**
 * A file name as a case-insensitive file system may see it (macOS APFS, Windows NTFS). Those ignore case
 * with full Unicode folding ("ſ" is "s", "K" (Kelvin) is "k") and APFS also ignores the normalization
 * form, while JavaScript's toLowerCase alone leaves "ſ" as it is. Upper-casing first applies the
 * folding; it folds a little more than a file system does (e.g. "ß" and "ss"), which only makes the
 * rules that use it stricter.
 */
export function foldName(name: string): string {
  return name.normalize("NFD").toUpperCase().toLowerCase().normalize("NFD");
}
