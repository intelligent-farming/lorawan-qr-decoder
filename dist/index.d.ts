/**
 * Decode the QR code printed on a LoRaWAN device into a structured object of
 * EUIs, keys, and (when available) the LoRa Alliance TR005 ownership token
 * and serial number.
 *
 * Strategy chain (first match wins):
 *
 * 1. **TR005** — LoRa Alliance "LoRaWAN Device Identification QR Codes"
 *    standard (`LW:D0:<JoinEUI>:<DevEUI>:<ProfileID>[...]`).
 * 2. **JSON** — vendors that emit a JSON object on their labels (Milesight is
 *    one example).
 * 3. **Key/value** — case-insensitive scan for `DevEUI=…`, `AppKey=…`, etc.
 *    Handles common separators: newlines, commas, semicolons, ampersands,
 *    whitespace, and tabs.
 * 4. **Hex-scan** — last-resort extraction of every 16-hex and 32-hex token
 *    in the string. When multiple 16-hex tokens are present, the IEEE OUI
 *    registry is consulted so the one belonging to a known LoRaWAN vendor is
 *    chosen as the DevEUI.
 *
 * Every successful result also includes a {@link VendorInfo} when the
 * DevEUI's OUI is in the registry — useful for telemetry, label printing,
 * and downstream provisioning logic.
 *
 * @packageDocumentation
 */
/** Strategy that produced a successful parse. */
export type ParseSource = 'tr005' | 'lwdp' | 'json' | 'key-value' | 'hex-scan';
/** Vendor identified from the DevEUI's IEEE OUI. */
export interface VendorInfo {
    /** The matched OUI assignment (6, 7, or 9 hex chars, uppercase). */
    oui: string;
    /** Organization name as registered with the IEEE. */
    name: string;
    /** True when the OUI matches a known LoRaWAN device vendor (see {@link KNOWN_LORAWAN_VENDORS}). */
    knownLorawanVendor: boolean;
    /** Slug for known LoRaWAN vendors — e.g. `"dragino"`, `"milesight"`, `"rak"`. */
    id?: string;
}
/** Decoded contents of a LoRaWAN device QR code. */
export interface QrParseResult {
    /** DevEUI, 16-char uppercase hex. Required — a result without a DevEUI is never returned. */
    devEui: string;
    /** JoinEUI (a.k.a. AppEUI before LoRaWAN 1.1), 16-char uppercase hex. */
    joinEui?: string;
    /** AppKey for LoRaWAN 1.0.x OTAA, or the 1.1.x AppKey for application-level encryption. 32-char uppercase hex. */
    appKey?: string;
    /** Network root key for LoRaWAN 1.1.x. 32-char uppercase hex. */
    nwkKey?: string;
    /** TR005 vendor-assigned device profile identifier (4 hex chars). */
    profileId?: string;
    /** Vendor serial number — TR005 optional field. */
    serialNumber?: string;
    /** Proof-of-ownership token — TR005 optional field used by Join Server claim flows. */
    ownerToken?: string;
    /** TR005 proprietary extension fields (prefix `P…`). */
    proprietary?: Record<string, string>;
    /** Detected vendor (best-effort, from the DevEUI's OUI). */
    vendor?: VendorInfo;
    /** Which strategy produced the result — useful for logging confidence. */
    source: ParseSource;
    /** Original input string. */
    raw: string;
}
/** Thrown when no strategy can extract at least a DevEUI from the input. */
export declare class QrParseError extends Error {
    readonly raw: string;
    /** Strategies that were attempted, in order. */
    readonly attempted: ParseSource[];
    constructor(raw: string, attempted: ParseSource[]);
}
/**
 * Known LoRaWAN device vendors keyed by IEEE OUI prefix. Used to:
 * - tag results with a stable {@link VendorInfo.id} slug
 * - pick the right 16-hex run as the DevEUI when the QR contains multiple EUIs
 *
 * Add entries here as you encounter new vendors in the field — the OUI registry
 * itself will still produce a `VendorInfo` for any matching OUI, just without
 * the `id` slug or `knownLorawanVendor: true`.
 */
export declare const KNOWN_LORAWAN_VENDORS: Record<string, string>;
/**
 * Resolve an OUI to its registered organization, and tag it with a LoRaWAN
 * vendor slug when {@link KNOWN_LORAWAN_VENDORS} has an entry for it.
 *
 * Delegates the underlying registry lookup (longest-prefix-match across
 * MA-L / MA-M / MA-S assignments) to `@intelligentfarming/oui-registry`,
 * then layers on this module's LoRaWAN-specific vendor catalog.
 *
 * @param devEui 16-character hex DevEUI (case-insensitive).
 * @returns A {@link VendorInfo} on match, or `undefined` if the OUI is unknown.
 */
export declare const detectVendor: (devEui: string) => VendorInfo | undefined;
/**
 * Decode a LoRaWAN device QR string. Tries TR005, then JSON, then key/value,
 * then a hex-scan disambiguated by OUI registry lookup.
 *
 * @throws {@link QrParseError} when no strategy can extract a DevEUI.
 *
 * @example
 * ```ts
 * import { parse } from '@intelligentfarming/lorawan-qr-decoder';
 *
 * // TR005 standard
 * parse('LW:D0:70B3D57ED0000001:A84041035660E3AA:AB12');
 * // → { devEui: 'A84041035660E3AA', joinEui: '70B3D57ED0000001',
 * //     profileId: 'AB12', source: 'tr005',
 * //     vendor: { oui: 'A84041', name: 'Dragino…', id: 'dragino', knownLorawanVendor: true },
 * //     raw: 'LW:D0:…' }
 *
 * // Multi-line key/value (common on Dragino labels)
 * parse('DevEUI=A84041035660E3AA\nAppEUI=70B3D57ED0000001\nAppKey=00112233445566778899AABBCCDDEEFF');
 * // → { devEui, joinEui, appKey, source: 'key-value', vendor: …, raw: … }
 * ```
 */
export declare const parse: (qr: string) => QrParseResult;
/** Input accepted by {@link encode} to produce a TR005 v1.0 QR code string. */
export interface EncodeInput {
    /** DevEUI — 16 hex chars (case-insensitive, separators allowed). */
    devEui: string;
    /** JoinEUI / AppEUI — 16 hex chars. */
    joinEui: string;
    /** Vendor-assigned 4-char hex Profile ID. */
    profileId: string;
    /** Optional proof-of-ownership token. Must not contain `:`. */
    ownerToken?: string;
    /** Optional vendor serial number. Must not contain `:`. */
    serialNumber?: string;
    /**
     * Optional proprietary extension fields, encoded as `P<key>=<value>`.
     * Keys must match `[A-Za-z0-9]+`; values must not contain `:` or `=`.
     */
    proprietary?: Record<string, string>;
}
/** Input accepted by {@link encodeLwdp} to produce a Browan-style LWDP URN. */
export interface LwdpEncodeInput {
    /** JoinEUI — 16 hex chars. Emitted first per LWDP convention. */
    joinEui: string;
    /** DevEUI — 16 hex chars. */
    devEui: string;
    /** Product code (alphanumeric, up to 20 chars). */
    productCode: string;
    /** Verification token — 4-16 hex chars (typically 8). */
    token: string;
}
/** Thrown when {@link encode} or {@link encodeLwdp} receives invalid input. */
export declare class QrEncodeError extends Error {
    /** The field that failed validation. */
    readonly field: string;
    constructor(field: string, detail: string);
}
/**
 * Generate a TR005 v1.0 LoRaWAN device identification QR code string.
 *
 * Round-trips with {@link parse}: `parse(encode(x))` recovers the same logical
 * fields (modulo case normalization on hex values). Validates all inputs and
 * throws {@link QrEncodeError} on bad data — including reserved characters
 * that would corrupt the format (`:` in tokens, `=` in proprietary keys).
 *
 * @example
 * ```ts
 * encode({
 *   devEui: 'A84041035660E3AA',
 *   joinEui: '70B3D57ED0000001',
 *   profileId: 'AB12',
 *   ownerToken: 'OWNER123',
 *   serialNumber: 'SN0001',
 *   proprietary: { foo: 'bar' },
 * });
 * // → 'LW:D0:70B3D57ED0000001:A84041035660E3AA:AB12:OWNER123:SN0001:Pfoo=bar'
 * ```
 */
export declare const encode: (input: EncodeInput) => string;
/**
 * Generate a Browan / Gemtek `URN:LWDP:` QR string. JoinEUI is emitted first
 * per LWDP convention. Round-trips with the LWDP parse strategy.
 */
export declare const encodeLwdp: (input: LwdpEncodeInput) => string;
//# sourceMappingURL=index.d.ts.map