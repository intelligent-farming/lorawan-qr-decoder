"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeLwdp = exports.encode = exports.QrEncodeError = exports.createParser = exports.parse = exports.detectVendor = exports.KNOWN_LORAWAN_VENDORS = exports.QrParseError = void 0;
const oui_registry_1 = require("@intelligent-farming/oui-registry");
const lorawan_credential_format_1 = require("@intelligent-farming/lorawan-credential-format");
/** Thrown when no strategy can extract at least a DevEUI from the input. */
class QrParseError extends Error {
    constructor(raw, attempted) {
        super(`Could not decode LoRaWAN QR code (tried: ${attempted.join(', ')}). Input: ${truncate(raw, 80)}`);
        this.name = 'QrParseError';
        this.raw = raw;
        this.attempted = attempted;
    }
}
exports.QrParseError = QrParseError;
/* -------------------------------------------------------------------------- */
/* OUI registry                                                                */
/* -------------------------------------------------------------------------- */
/**
 * Known LoRaWAN device vendors keyed by IEEE OUI prefix. Used to:
 * - tag results with a stable {@link VendorInfo.id} slug
 * - pick the right 16-hex run as the DevEUI when the QR contains multiple EUIs
 *
 * Add entries here as you encounter new vendors in the field — the OUI registry
 * itself will still produce a `VendorInfo` for any matching OUI, just without
 * the `id` slug or `knownLorawanVendor: true`.
 */
exports.KNOWN_LORAWAN_VENDORS = {
    A84041: 'dragino',
    '24E124': 'milesight',
    AC1F09: 'rak',
    '2CF7F1': 'seeed',
    // Browan IoT devices ship under two OUIs: their parent Gemtek's E8:E1:E1
    // and TrackNet's 58:A0:CB (a Browan precursor company since acquired by
    // Semtech).
    E8E1E1: 'browan',
    '58A0CB': 'browan',
};
/**
 * Resolve an OUI to its registered organization, and tag it with a LoRaWAN
 * vendor slug when {@link KNOWN_LORAWAN_VENDORS} has an entry for it.
 *
 * Delegates the underlying registry lookup (longest-prefix-match across
 * MA-L / MA-M / MA-S assignments) to `@intelligent-farming/oui-registry`,
 * then layers on this module's LoRaWAN-specific vendor catalog.
 *
 * @param devEui   16-character hex DevEUI (case-insensitive).
 * @param registry Optional OUI registry. When provided, the lookup runs against
 *                 it directly (browser-safe). When omitted, falls back to the
 *                 Node-only bundled snapshot via `fs` — which fails in browsers.
 * @returns A {@link VendorInfo} on match, or `undefined` if the OUI is unknown.
 */
const detectVendor = (devEui, registry) => {
    const match = registry ? (0, oui_registry_1.lookup)(registry, devEui) : (0, oui_registry_1.detectVendor)(devEui);
    if (!match)
        return undefined;
    const id = exports.KNOWN_LORAWAN_VENDORS[devEui.toUpperCase().slice(0, 6)];
    return { oui: match.oui, name: match.name, knownLorawanVendor: !!id, id };
};
exports.detectVendor = detectVendor;
/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */
/**
 * Decode a LoRaWAN device QR string. Tries TR005, then JSON, then key/value,
 * then a hex-scan disambiguated by OUI registry lookup.
 *
 * @throws {@link QrParseError} when no strategy can extract a DevEUI.
 *
 * @example
 * ```ts
 * import { parse } from '@intelligent-farming/lorawan-qr-decoder';
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
const parse = (qr, opts = {}) => {
    if (typeof qr !== 'string' || qr.length === 0) {
        throw new QrParseError(String(qr ?? ''), []);
    }
    const raw = qr.trim();
    const attempted = [];
    for (const strat of STRATEGIES) {
        attempted.push(strat.source);
        const partial = strat.run(raw, opts);
        if (partial) {
            const finalized = finalize(partial, strat.source, raw, opts);
            if (finalized)
                return finalized;
        }
    }
    throw new QrParseError(raw, attempted);
};
exports.parse = parse;
/**
 * Bind {@link ParseOptions} into a closure and return a parser that doesn't
 * require the options on every call. Designed for browser callers that import
 * the OUI registry JSON once at startup.
 *
 * @example
 * ```ts
 * import ouis from '@intelligent-farming/oui-registry/data/ouis.json';
 * import { createParser } from '@intelligent-farming/lorawan-qr-decoder';
 *
 * const parse = createParser({ ouiRegistry: ouis });
 * parse(qrFromCamera);   // no second arg needed
 * ```
 */
const createParser = (opts) => {
    return (qr) => (0, exports.parse)(qr, opts);
};
exports.createParser = createParser;
/* -------------------------------------------------------------------------- */
/* Strategy: TR005                                                             */
/* -------------------------------------------------------------------------- */
/**
 * TR005 v1.0 / v1.0.1 grammar:
 *   `LW:D0:<JoinEUI>:<DevEUI>:<ProfileID>[:<OwnerToken>][:<SerNum>][:<P…>]…`
 *
 * The OwnerToken / SerNum positions are optional; vendors may also append
 * proprietary fields prefixed with `P`. We accept either case for the scheme
 * (`LW` / `lw`) but the documented format uses uppercase.
 */
const TR005_RE = /^LW:D[0-9A-F]:([0-9A-Fa-f]{16}):([0-9A-Fa-f]{16}):([0-9A-Fa-f]{4})(?::(.*))?$/;
const parseTr005 = (raw) => {
    const m = TR005_RE.exec(raw);
    if (!m)
        return null;
    const out = {
        joinEui: m[1].toUpperCase(),
        devEui: m[2].toUpperCase(),
        profileId: m[3].toUpperCase(),
    };
    if (m[4]) {
        const rest = m[4].split(':');
        // Positional fields per TR005: OwnerToken, SerNum. After that, any field
        // beginning with `P` is a proprietary key-value (`P<key>=<value>` or
        // `P<key>:<value>`).
        // TR005 proprietary fields are encoded as `P<key>=<value>` — `:` is reserved
        // as the outer field delimiter and can't appear inside a proprietary value.
        let pos = 0;
        for (const field of rest) {
            const propEq = field.startsWith('P') && field.indexOf('=', 1);
            if (typeof propEq === 'number' && propEq > 1) {
                const proprietary = out.proprietary ?? (out.proprietary = {});
                proprietary[field.slice(1, propEq)] = field.slice(propEq + 1);
                continue;
            }
            if (pos === 0)
                out.ownerToken = field || undefined;
            else if (pos === 1)
                out.serialNumber = field || undefined;
            pos++;
        }
    }
    return out;
};
/* -------------------------------------------------------------------------- */
/* Strategy: LWDP (Browan / Gemtek URN format)                                 */
/* -------------------------------------------------------------------------- */
/**
 * Browan / Gemtek's `URN:LWDP:<JoinEUI>:<DevEUI>:<ProductCode>:<Token>` format.
 * Used on Tabs sensors (TBOL100, TBAM100, TBSP100, TBMS100, …).
 *
 * Critically, the **JoinEUI comes first** here, opposite of the field order
 * implied by the hex-scan heuristics — that's why we need a dedicated strategy
 * rather than relying on hex-scan to figure it out.
 *
 * The product code is captured in `proprietary.productCode` and the
 * verification token in `proprietary.token`.
 */
const LWDP_RE = /^URN:LWDP:([0-9A-Fa-f]{16}):([0-9A-Fa-f]{16}):([A-Za-z0-9]{1,20}):([0-9A-Fa-f]{4,16})$/;
const parseLwdp = (raw) => {
    const m = LWDP_RE.exec(raw);
    if (!m)
        return null;
    return {
        joinEui: m[1].toUpperCase(),
        devEui: m[2].toUpperCase(),
        proprietary: { productCode: m[3], token: m[4].toUpperCase() },
    };
};
/* -------------------------------------------------------------------------- */
/* Strategy: JSON                                                              */
/* -------------------------------------------------------------------------- */
const parseJson = (raw) => {
    if (!raw.startsWith('{'))
        return null;
    let obj;
    try {
        obj = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!obj || typeof obj !== 'object')
        return null;
    return extractKeyValues(obj);
};
/* -------------------------------------------------------------------------- */
/* Strategy: key/value                                                         */
/* -------------------------------------------------------------------------- */
/** Aliases mapped to the canonical {@link QrParseResult} field name. */
const KEY_ALIASES = {
    deveui: 'devEui', dev_eui: 'devEui', 'dev-eui': 'devEui',
    joineui: 'joinEui', join_eui: 'joinEui', 'join-eui': 'joinEui',
    appeui: 'joinEui', app_eui: 'joinEui', 'app-eui': 'joinEui',
    appkey: 'appKey', app_key: 'appKey', 'app-key': 'appKey',
    nwkkey: 'nwkKey', nwk_key: 'nwkKey', 'nwk-key': 'nwkKey',
    serial: 'serialNumber', serialnumber: 'serialNumber', sn: 'serialNumber',
    profileid: 'profileId', profile_id: 'profileId',
};
const parseKeyValue = (raw) => {
    // Split on common separators between pairs. We keep `=` and `:` for the
    // *inside* of each pair.
    const pairs = raw.split(/[\r\n,;&\t]+|\s{2,}|(?<=\S)\s+(?=[A-Za-z][A-Za-z_-]*\s*[=:])/);
    const obj = {};
    let found = 0;
    for (const pair of pairs) {
        const m = /^\s*([A-Za-z][A-Za-z_-]*)\s*[=:]\s*(.+?)\s*$/.exec(pair);
        if (!m)
            continue;
        obj[m[1].toLowerCase().replace(/-/g, '-')] = m[2];
        found++;
    }
    if (found === 0)
        return null;
    return extractKeyValues(obj);
};
const extractKeyValues = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== 'string')
            continue;
        const field = KEY_ALIASES[k.toLowerCase().replace(/[\s]/g, '')];
        if (!field)
            continue;
        out[field] = v.trim().replace(/[\s:-]/g, '').toUpperCase();
    }
    return out.devEui ? out : null;
};
/* -------------------------------------------------------------------------- */
/* Strategy: hex-scan                                                          */
/* -------------------------------------------------------------------------- */
/**
 * Pull every 16-hex (EUI) and 32-hex (key) run out of the string. If multiple
 * 16-hex tokens are present, the OUI registry picks the most-likely DevEUI:
 *
 * - Prefer the one whose OUI maps to a {@link KNOWN_LORAWAN_VENDORS} entry.
 * - If none, prefer one whose OUI is in the IEEE registry at all.
 * - If still tied, take the first occurrence.
 *
 * 32-hex tokens are assigned to `appKey`; a second one (if present) becomes
 * `nwkKey`. Order in the source string is preserved.
 */
const parseHexScan = (raw, opts) => {
    // Pass 1 (high confidence) — explicit boundaries. Matches hex runs of exactly
    // 16 or 32 chars that are bracketed by non-hex on both sides, so a
    // separator-delimited "DevEUI <space> AppKey" string disambiguates cleanly.
    const upper = raw.toUpperCase();
    const eui = upper.match(/(?<![0-9A-F])[0-9A-F]{16}(?![0-9A-F])/g) ?? [];
    const key = upper.match(/(?<![0-9A-F])[0-9A-F]{32}(?![0-9A-F])/g) ?? [];
    // If pass 1 found a 32-hex run but no EUIs, the run *might* actually be
    // DevEUI(16)+JoinEUI(16) concatenated rather than an AppKey. Vendors like
    // Seeed print their SenseCAP QR codes this way. Apply the split when the
    // first 16 chars match a registered IEEE OUI — random AppKey bytes very
    // rarely collide with the OUI registry, so this is a strong signal.
    if (eui.length === 0 && key.length > 0) {
        for (let i = 0; i < key.length; i++) {
            const k = key[i];
            if ((0, exports.detectVendor)(k.slice(0, 16), opts?.ouiRegistry)) {
                eui.push(k.slice(0, 16), k.slice(16));
                key.splice(i, 1);
                i--;
            }
        }
    }
    // Pass 2 (low confidence) — only if pass 1 produced nothing. Strip every
    // non-hex character and chunk the resulting run(s) so a byte-grouped DevEUI
    // like `A8-40-41-03-56-60-E3-AA` is still recoverable. We deliberately do
    // *not* run this when pass 1 found anything, because the condensing step
    // erases field boundaries and can fabricate spurious EUIs by concatenating
    // adjacent non-hex tokens like decimal product codes.
    if (eui.length === 0 && key.length === 0) {
        const condensed = raw.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
        for (const run of condensed.match(/[0-9A-F]{16,}/g) ?? []) {
            let i = 0;
            while (i < run.length) {
                if (i + 32 <= run.length) {
                    key.push(run.slice(i, i + 32));
                    i += 32;
                }
                else if (i + 16 <= run.length) {
                    eui.push(run.slice(i, i + 16));
                    i += 16;
                }
                else
                    break;
            }
        }
    }
    if (eui.length === 0)
        return null;
    // Among the non-hex tokens, pick the longest one that looks like a serial
    // number (3-32 chars of alphanumerics, dashes, or underscores). Longer
    // tokens are far more likely to be a per-device serial than a region flag
    // or SKU code. Ties broken by first occurrence. This is a best-effort
    // heuristic — callers should treat `serialNumber` as advisory.
    //
    // A token is considered an EUI/key (and therefore not serial-eligible) if
    // its hex chars alone — after stripping `-` and whitespace — total 16 or 32.
    // That excludes byte-grouped forms like `A8-40-41-03-56-60-E3-AA` while
    // preserving legitimate dashed serials like `SKU-1000468`.
    const tokens = raw.split(/[;,|:\s\t\r\n]+/).filter(Boolean);
    const isHexIdentifier = (t) => {
        const h = t.replace(/[-\s]/g, '');
        return /^[0-9A-Fa-f]{16}$/.test(h) || /^[0-9A-Fa-f]{32}$/.test(h);
    };
    const candidates = tokens.filter(t => !isHexIdentifier(t) && /^[A-Za-z0-9_-]{3,32}$/.test(t));
    let serialNumber;
    for (const c of candidates) {
        if (!serialNumber || c.length > serialNumber.length)
            serialNumber = c;
    }
    // Score each candidate DevEUI by OUI match quality.
    let devEui = eui[0];
    let bestScore = -1;
    for (const e of eui) {
        const v = (0, exports.detectVendor)(e, opts?.ouiRegistry);
        const score = v ? (v.knownLorawanVendor ? 2 : 1) : 0;
        if (score > bestScore) {
            bestScore = score;
            devEui = e;
        }
    }
    const out = { devEui };
    // Remaining 16-hex → joinEui (first one).
    const joinEui = eui.find(e => e !== devEui);
    if (joinEui)
        out.joinEui = joinEui;
    if (key[0])
        out.appKey = key[0];
    if (key[1])
        out.nwkKey = key[1];
    if (serialNumber)
        out.serialNumber = serialNumber;
    return out;
};
const STRATEGIES = [
    { source: 'tr005', run: parseTr005 },
    { source: 'lwdp', run: parseLwdp },
    { source: 'json', run: parseJson },
    { source: 'key-value', run: parseKeyValue },
    { source: 'hex-scan', run: parseHexScan },
];
const HEX16 = /^[0-9A-F]{16}$/;
const HEX32 = /^[0-9A-F]{32}$/;
const HEX4 = /^[0-9A-F]{4}$/;
const finalize = (partial, source, raw, opts) => {
    if (!partial.devEui)
        return null;
    const devEui = partial.devEui.toUpperCase();
    if (!HEX16.test(devEui))
        return null;
    const out = { devEui, source, raw };
    if (partial.joinEui) {
        const j = partial.joinEui.toUpperCase();
        if (HEX16.test(j))
            out.joinEui = j;
    }
    if (partial.appKey) {
        const k = partial.appKey.toUpperCase();
        if (HEX32.test(k))
            out.appKey = k;
    }
    if (partial.nwkKey) {
        const k = partial.nwkKey.toUpperCase();
        if (HEX32.test(k))
            out.nwkKey = k;
    }
    if (partial.profileId && HEX4.test(partial.profileId.toUpperCase())) {
        out.profileId = partial.profileId.toUpperCase();
    }
    if (partial.serialNumber)
        out.serialNumber = partial.serialNumber;
    if (partial.ownerToken)
        out.ownerToken = partial.ownerToken;
    if (partial.proprietary)
        out.proprietary = partial.proprietary;
    const vendor = (0, exports.detectVendor)(devEui, opts?.ouiRegistry);
    if (vendor)
        out.vendor = vendor;
    return out;
};
/** Thrown when {@link encode} or {@link encodeLwdp} receives invalid input. */
class QrEncodeError extends Error {
    constructor(field, detail) {
        super(`Invalid ${field}: ${detail}`);
        this.name = 'QrEncodeError';
        this.field = field;
    }
}
exports.QrEncodeError = QrEncodeError;
/* -------------------------------------------------------------------------- */
/* Encoder: TR005                                                              */
/* -------------------------------------------------------------------------- */
const PROFILE_ID_RE = /^[0-9A-Fa-f]{4}$/;
const PROPRIETARY_KEY_RE = /^[A-Za-z0-9]+$/;
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
const encode = (input) => {
    const devEui = parseHexField('devEui', input.devEui, lorawan_credential_format_1.parseDevEui);
    const joinEui = parseHexField('joinEui', input.joinEui, lorawan_credential_format_1.parseJoinEui);
    const profileId = (0, lorawan_credential_format_1.normalize)(input.profileId ?? '');
    if (!PROFILE_ID_RE.test(profileId)) {
        throw new QrEncodeError('profileId', `expected 4 hex chars, got ${JSON.stringify(input.profileId)}`);
    }
    const fields = [`LW:D0:${joinEui}:${devEui}:${profileId}`];
    // TR005 positional extension fields: OwnerToken, then SerNum. Both forbid `:`
    // since it's the outer field separator. Trailing-empty positional fields are
    // dropped — only emit them when needed to keep a later field reachable.
    const owner = input.ownerToken;
    const serial = input.serialNumber;
    const proprietary = input.proprietary;
    if (owner !== undefined)
        assertNoColon('ownerToken', owner);
    if (serial !== undefined)
        assertNoColon('serialNumber', serial);
    if (owner !== undefined || serial !== undefined || proprietary) {
        fields.push(owner ?? '');
    }
    if (serial !== undefined || proprietary) {
        fields.push(serial ?? '');
    }
    if (proprietary) {
        for (const [k, v] of Object.entries(proprietary)) {
            if (!PROPRIETARY_KEY_RE.test(k)) {
                throw new QrEncodeError('proprietary', `key ${JSON.stringify(k)} must match [A-Za-z0-9]+`);
            }
            if (v.includes(':'))
                throw new QrEncodeError('proprietary', `value for ${k} must not contain ':'`);
            fields.push(`P${k}=${v}`);
        }
    }
    return fields.join(':');
};
exports.encode = encode;
/* -------------------------------------------------------------------------- */
/* Encoder: LWDP                                                               */
/* -------------------------------------------------------------------------- */
const LWDP_PRODUCT_RE = /^[A-Za-z0-9]{1,20}$/;
const LWDP_TOKEN_RE = /^[0-9A-Fa-f]{4,16}$/;
/**
 * Generate a Browan / Gemtek `URN:LWDP:` QR string. JoinEUI is emitted first
 * per LWDP convention. Round-trips with the LWDP parse strategy.
 */
const encodeLwdp = (input) => {
    const joinEui = parseHexField('joinEui', input.joinEui, lorawan_credential_format_1.parseJoinEui);
    const devEui = parseHexField('devEui', input.devEui, lorawan_credential_format_1.parseDevEui);
    if (!LWDP_PRODUCT_RE.test(input.productCode ?? '')) {
        throw new QrEncodeError('productCode', `expected 1-20 alphanumeric chars, got ${JSON.stringify(input.productCode)}`);
    }
    const token = (0, lorawan_credential_format_1.normalize)(input.token ?? '');
    if (!LWDP_TOKEN_RE.test(token)) {
        throw new QrEncodeError('token', `expected 4-16 hex chars, got ${JSON.stringify(input.token)}`);
    }
    return `URN:LWDP:${joinEui}:${devEui}:${input.productCode}:${token}`;
};
exports.encodeLwdp = encodeLwdp;
/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */
const parseHexField = (field, input, parser) => {
    try {
        return parser(input);
    }
    catch (err) {
        if (err instanceof lorawan_credential_format_1.CredentialFormatError)
            throw new QrEncodeError(field, err.message);
        throw err;
    }
};
const assertNoColon = (field, value) => {
    if (value.includes(':'))
        throw new QrEncodeError(field, "must not contain ':' (reserved as TR005 field separator)");
};
const truncate = (s, n) => s.length <= n ? s : s.slice(0, n - 1) + '…';
//# sourceMappingURL=index.js.map