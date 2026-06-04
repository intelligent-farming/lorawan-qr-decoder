# @intelligent-farming/lorawan-qr-decoder

Decode the QR code printed on a LoRaWAN device into a structured object of EUIs, keys, and (when available) profile / serial / ownership metadata. Implements the LoRa Alliance TR005 standard, the Browan / Gemtek LWDP URN format, and falls back to brand-aware heuristics (Dragino, Milesight, RAK, Seeed, Browan) for vendors that don't conform.

Full API reference: [docs/api-doc.md](docs/api-doc.md). Regenerate with `npm run docs`.

## Install

```sh
npm install @intelligent-farming/lorawan-qr-decoder
```

## Usage

### Node

```ts
import { parse, encode, QrParseError } from '@intelligent-farming/lorawan-qr-decoder';

// TR005 standard
parse('LW:D0:70B3D57ED0000001:A84041035660E3AA:AB12');
// → { devEui: 'A84041035660E3AA', joinEui: '70B3D57ED0000001',
//     profileId: 'AB12', source: 'tr005',
//     vendor: { oui: 'A84041', name: 'Dragino…', id: 'dragino', knownLorawanVendor: true },
//     raw: 'LW:D0:…' }

// Multi-line key/value (common on Dragino labels)
parse('DevEUI=A84041035660E3AA\nAppEUI=70B3D57ED0000001\nAppKey=00112233445566778899AABBCCDDEEFF');
// → { devEui, joinEui, appKey, source: 'key-value', vendor: …, raw: … }

// Round-trip: encode emits TR005 v1.0
encode({
  devEui: 'A84041035660E3AA',
  joinEui: '70B3D57ED0000001',
  profileId: 'AB12',
  serialNumber: 'SN0001',
});
// → 'LW:D0:70B3D57ED0000001:A84041035660E3AA:AB12::SN0001'
```

### Browser

The Node convenience layer loads the OUI registry via `fs`. In a browser bundle, import the registry JSON yourself and pass it through `createParser`:

```ts
import ouis from '@intelligent-farming/oui-registry/data/ouis.json';
import { createParser } from '@intelligent-farming/lorawan-qr-decoder';

const parse = createParser({ ouiRegistry: ouis });
parse(qrFromCamera);   // no second arg needed
```

## Strategy chain

The parser tries each strategy in order; the first one that yields at least a DevEUI wins. The `source` field on the result tells you which one matched — useful for logging parse confidence.

1. **`tr005`** — `LW:D0:<JoinEUI>:<DevEUI>:<ProfileID>[:OwnerToken[:SerNum[:P…]]]`. LoRa Alliance "LoRaWAN Device Identification QR Codes" standard.
2. **`lwdp`** — `URN:LWDP:<JoinEUI>:<DevEUI>:<ProductCode>:<Token>`. Browan / Gemtek format used on Tabs sensors. JoinEUI comes first here.
3. **`json`** — vendors that emit a JSON object on their labels (Milesight is one example).
4. **`key-value`** — case-insensitive scan for `DevEUI=…`, `AppKey=…`, etc. Handles newlines, commas, semicolons, ampersands, whitespace, and tabs as separators.
5. **`hex-scan`** — last-resort extraction of every 16-hex and 32-hex run. When multiple 16-hex tokens are present, the IEEE OUI registry picks the most-likely DevEUI (one whose OUI matches a known LoRaWAN vendor wins).

When no strategy matches, `parse()` throws `QrParseError` listing the strategies it attempted.

## Errors

```ts
import { QrParseError, QrEncodeError } from '@intelligent-farming/lorawan-qr-decoder';

try { parse(scanned); }
catch (e) {
  if (e instanceof QrParseError) {
    console.warn(`Could not decode QR (tried: ${e.attempted.join(', ')})`);
  } else { throw e; }
}
```

`encode()` and `encodeLwdp()` throw `QrEncodeError` on invalid inputs — including reserved characters that would corrupt the format (`:` in tokens, `=` in proprietary keys).
