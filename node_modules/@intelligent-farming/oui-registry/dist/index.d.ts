/**
 * Shared IEEE OUI registry for LoRaWAN tooling.
 *
 * The module is split into two layers:
 *
 * - **Pure / isomorphic**: {@link lookup}, {@link parseOuiCsv}, type
 *   definitions. Take the registry data as an explicit parameter and run
 *   anywhere — Node, browser, edge runtime, Cloudflare Workers, etc.
 * - **Node convenience**: {@link detectVendor}, {@link loadBundled},
 *   {@link updateOuis}, {@link cachePath}. Auto-load the bundled snapshot via
 *   `fs` and refresh from IEEE on demand. Calling these in a browser bundle
 *   will throw a clear error directing the caller to the pure-layer APIs.
 *
 * @example Browser usage
 * ```ts
 * import ouis from '@intelligent-farming/oui-registry/data/ouis.json';
 * import { lookup } from '@intelligent-farming/oui-registry';
 *
 * lookup(ouis, 'A84041035660E3AA');
 * // → { oui: 'A84041', name: 'Dragino Technology Co., Limited' }
 * ```
 *
 * @example Node usage
 * ```ts
 * import { detectVendor, updateOuis } from '@intelligent-farming/oui-registry';
 *
 * detectVendor('A84041035660E3AA');
 * // → { oui: 'A84041', name: 'Dragino Technology Co., Limited' }
 *
 * await updateOuis();   // refresh from IEEE into the cache
 * ```
 *
 * @packageDocumentation
 */
/**
 * Flat registry map: hex-string OUI assignment → registered organization
 * name. Keys are uppercase and may be 6 (MA-L 24-bit), 7 (MA-M 28-bit), or
 * 9 (MA-S 36-bit) hex characters long.
 */
export type OuiRegistry = Record<string, string>;
/** A matched OUI assignment. */
export interface VendorInfo {
    /** The matched assignment (6, 7, or 9 hex chars, uppercase). */
    oui: string;
    /** Organization name as registered with the IEEE. */
    name: string;
}
/**
 * Look up the IEEE-registered organization for a 16-character hex EUI.
 *
 * Performs **longest-prefix-match** against MA-S (9 chars) → MA-M (7 chars)
 * → MA-L (6 chars). Required because many LoRaWAN vendors hold MA-S
 * sub-allocations under MA-L holders' broader blocks — without longest-prefix
 * the lookup would incorrectly report the parent block's owner.
 *
 * Pure function: takes the registry explicitly. Use this directly in browser
 * code with `import data from '@intelligent-farming/oui-registry/data/ouis.json'`.
 *
 * @param registry The flat OUI map (see {@link OuiRegistry}).
 * @param eui      16-character hex EUI, case-insensitive.
 * @returns A {@link VendorInfo} when matched, `undefined` when the EUI's OUI
 *          is unregistered or the input is not a valid 16-hex string.
 */
export declare const lookup: (registry: OuiRegistry, eui: string) => VendorInfo | undefined;
/**
 * Parse the IEEE OUI CSV format into the flat map this module uses. Exposed
 * for build scripts that download fresh CSVs from `standards-oui.ieee.org`
 * and bake them into the bundled snapshot; not normally needed at runtime.
 *
 * Header (varies slightly per registry): `Registry,Assignment,Organization Name,Organization Address`.
 *
 * @internal Exposed for {@link updateOuis} and the build script.
 */
export declare const parseOuiCsv: (csv: string) => OuiRegistry;
/**
 * The cache file `updateOuis()` writes to. Honors `OUI_REGISTRY_CACHE` and
 * `XDG_CACHE_HOME` env vars; otherwise falls back to
 * `~/.cache/intelligentfarming-oui-registry/ouis.json`.
 *
 * **Node only.** Throws in environments without `fs` / `path` / `os`.
 */
export declare const cachePath: () => string;
/**
 * Load the registry from disk, preferring the user cache (when
 * {@link updateOuis} has been run) over the bundled snapshot.
 *
 * Result is memoized — subsequent calls return the same object. To re-read
 * after writing the cache, call {@link clearCache} first.
 *
 * **Node only.** Throws a clear error in browsers; use {@link lookup} with an
 * imported JSON instead.
 */
export declare const loadBundled: () => OuiRegistry;
/** Drop the in-memory registry cache so the next call re-reads from disk. */
export declare const clearCache: () => void;
/**
 * Convenience wrapper: looks up `eui` against the bundled / cached registry.
 *
 * Equivalent to `lookup(loadBundled(), eui)`. **Node only.**
 */
export declare const detectVendor: (eui: string) => VendorInfo | undefined;
/**
 * Download the three IEEE OUI CSVs (MA-L / MA-M / MA-S), parse them into the
 * compact JSON shape this module uses, and write the merged result to the
 * cache file returned by {@link cachePath}. The next {@link detectVendor}
 * call (after {@link clearCache}) picks up the refreshed data.
 *
 * **Node only.**
 *
 * @returns The cache file path that was written.
 */
export declare const updateOuis: () => Promise<string>;
//# sourceMappingURL=index.d.ts.map