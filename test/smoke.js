// Unit test against the OUI registry bundled in data/. Verifies each parsing
// strategy and vendor identification.

const assert = require('assert');
const { parse, detectVendor, QrParseError, KNOWN_LORAWAN_VENDORS } = require('..');

/* --- TR005 minimal --- */
{
  const out = parse('LW:D0:70B3D57ED0000001:A84041035660E3AA:AB12');
  assert.strictEqual(out.source, 'tr005');
  assert.strictEqual(out.devEui, 'A84041035660E3AA');
  assert.strictEqual(out.joinEui, '70B3D57ED0000001');
  assert.strictEqual(out.profileId, 'AB12');
  assert.strictEqual(out.appKey, undefined);   // TR005 never carries keys
  assert.strictEqual(out.vendor.id, 'dragino');
  assert.strictEqual(out.vendor.oui, 'A84041');
  console.log('✓ TR005 minimal parse + Dragino OUI lookup');
}

/* --- TR005 with owner token, serial number, and proprietary fields --- */
{
  const out = parse('LW:D0:70B3D57ED0000001:A84041035660E3AA:AB12:OWNERTOKEN:SN-0001:Pfoo=bar:Pbaz=qux');
  assert.strictEqual(out.source, 'tr005');
  assert.strictEqual(out.ownerToken, 'OWNERTOKEN');
  assert.strictEqual(out.serialNumber, 'SN-0001');
  assert.deepStrictEqual(out.proprietary, { foo: 'bar', baz: 'qux' });
  console.log('✓ TR005 extended fields (owner token, serial, proprietary)');
}

/* --- TR005 with lowercase hex normalizes to uppercase --- */
{
  const out = parse('LW:D0:70b3d57ed0000001:a84041035660e3aa:ab12');
  assert.strictEqual(out.devEui, 'A84041035660E3AA');
  assert.strictEqual(out.joinEui, '70B3D57ED0000001');
  assert.strictEqual(out.profileId, 'AB12');
  console.log('✓ TR005 normalizes hex to uppercase');
}

/* --- JSON (Milesight-style) --- */
{
  const out = parse('{"DevEUI":"24E124136D456789","AppEUI":"24E124C0002A0001","AppKey":"5572404C696E6B4C6F52613230313823"}');
  assert.strictEqual(out.source, 'json');
  assert.strictEqual(out.devEui, '24E124136D456789');
  assert.strictEqual(out.joinEui, '24E124C0002A0001');
  assert.strictEqual(out.appKey, '5572404C696E6B4C6F52613230313823');
  assert.strictEqual(out.vendor.id, 'milesight');
  console.log('✓ JSON object with Milesight-style keys');
}

/* --- key/value multiline (Dragino-style label) --- */
{
  const qr = 'DevEUI=A84041035660E3AA\nAppEUI=70B3D57ED0000001\nAppKey=00112233445566778899AABBCCDDEEFF';
  const out = parse(qr);
  assert.strictEqual(out.source, 'key-value');
  assert.strictEqual(out.devEui, 'A84041035660E3AA');
  assert.strictEqual(out.joinEui, '70B3D57ED0000001');
  assert.strictEqual(out.appKey, '00112233445566778899AABBCCDDEEFF');
  assert.strictEqual(out.vendor.id, 'dragino');
  console.log('✓ multi-line key=value (Dragino label format)');
}

/* --- key/value comma-separated with colon delimiters --- */
{
  const qr = 'DevEUI:24E124136D456789,AppKey:5572404C696E6B4C6F52613230313823,AppEUI:24E124C0002A0001';
  const out = parse(qr);
  assert.strictEqual(out.source, 'key-value');
  assert.strictEqual(out.devEui, '24E124136D456789');
  assert.strictEqual(out.appKey, '5572404C696E6B4C6F52613230313823');
  assert.strictEqual(out.joinEui, '24E124C0002A0001');
  console.log('✓ comma-separated key:value (Milesight label format)');
}

/* --- key/value with colon-grouped hex (e.g. 24:E1:24:13:6D:45:67:89) --- */
{
  const qr = 'DevEUI=24:E1:24:13:6D:45:67:89\nAppKey=55:72:40:4C:69:6E:6B:4C:6F:52:61:32:30:31:38:23';
  const out = parse(qr);
  assert.strictEqual(out.devEui, '24E124136D456789');
  assert.strictEqual(out.appKey, '5572404C696E6B4C6F52613230313823');
  assert.strictEqual(out.vendor.id, 'milesight');
  console.log('✓ key/value with byte-grouped hex (colons stripped from value)');
}

/* --- hex-scan: dash-separated DevEUI on its own line --- */
{
  const qr = 'A8-40-41-03-56-60-E3-AA';
  const out = parse(qr);
  assert.strictEqual(out.source, 'hex-scan');
  assert.strictEqual(out.devEui, 'A84041035660E3AA');
  assert.strictEqual(out.vendor.id, 'dragino');
  console.log('✓ hex-scan recovers a bare DevEUI from dash-separated hex');
}

/* --- hex-scan disambiguation by OUI when JoinEUI appears first --- */
{
  // JoinEUI listed first; DevEUI second. Hex-scan should still pick the
  // Dragino-OUI EUI as the DevEUI based on vendor scoring.
  const qr = 'AppEUI 70B3D57ED0000001 then device A84041035660E3AA';
  const out = parse(qr);
  assert.strictEqual(out.source, 'hex-scan');
  assert.strictEqual(out.devEui, 'A84041035660E3AA');     // Dragino wins
  assert.strictEqual(out.joinEui, '70B3D57ED0000001');
  console.log('✓ hex-scan picks the known-vendor EUI as the DevEUI');
}

/* --- hex-scan captures a single non-hex token as serialNumber --- */
{
  // Dragino positional label: <serial>;<DevEUI>;<JoinEUI>;<AppKey>.
  const qr = 'DS026349738;A84041035660E3AA;A840410000000107;A66A89B6606C1BD125B54E7CA4B10DD4';
  const out = parse(qr);
  assert.strictEqual(out.source, 'hex-scan');
  assert.strictEqual(out.devEui, 'A84041035660E3AA');
  assert.strictEqual(out.joinEui, 'A840410000000107');
  assert.strictEqual(out.appKey, 'A66A89B6606C1BD125B54E7CA4B10DD4');
  assert.strictEqual(out.serialNumber, 'DS026349738');
  assert.strictEqual(out.vendor.id, 'dragino');
  console.log('✓ hex-scan captures a lone non-hex token as serialNumber (Dragino positional format)');
}

/* --- hex-scan picks the longest non-hex token as serialNumber --- */
{
  // Longest leftover wins; ties broken by first occurrence.
  const qr = 'v1 SKU-1000468 SN-99887766 A84041035660E3AA';
  const out = parse(qr);
  assert.strictEqual(out.devEui, 'A84041035660E3AA');
  assert.strictEqual(out.serialNumber, 'SKU-1000468');             // 11 chars > 'SN-99887766' (11 chars), first wins
  console.log('✓ hex-scan picks the longest non-hex leftover as serialNumber');
}

/* --- hex-scan still produces no serial when nothing meets the format --- */
{
  // Only the EUI; no leftover tokens at all.
  const out = parse('A84041035660E3AA');
  assert.strictEqual(out.devEui, 'A84041035660E3AA');
  assert.strictEqual(out.serialNumber, undefined);
  console.log('✓ hex-scan leaves serialNumber undefined when there are no leftover tokens');
}

/* --- Seeed-style: 32-hex is DevEUI+JoinEUI concatenated, not an AppKey --- */
{
  const qr = '2CF7F1C04490010D8FA012C179CF2BD9:0:1000468:114992868224900030';
  const out = parse(qr);
  assert.strictEqual(out.source, 'hex-scan');
  assert.strictEqual(out.devEui, '2CF7F1C04490010D');
  assert.strictEqual(out.joinEui, '8FA012C179CF2BD9');
  assert.strictEqual(out.appKey, undefined);                       // never an AppKey here
  assert.strictEqual(out.nwkKey, undefined);
  assert.strictEqual(out.vendor.id, 'seeed');
  assert.strictEqual(out.vendor.knownLorawanVendor, true);
  assert.strictEqual(out.serialNumber, '114992868224900030');      // longest leftover
  console.log('✓ hex-scan splits a 32-hex run into DevEUI+JoinEUI when the first half matches an OUI (Seeed)');
}

/* --- regression: no phantom DevEUI from concatenated non-hex tokens --- */
{
  // The condensed `0` + `1000468` + `114992868...` digits used to be smashed
  // together into a fake 16-hex DevEUI. The strict pass-2 guard prevents that.
  // Replace the recognizable Seeed OUI with FFFFFF so neither the split nor
  // pass-1 finds a DevEUI — the parser must now fail cleanly.
  const qr = 'FFFFFFC04490010D0000000000000000:0:1000468:114992868224900030';
  assert.throws(() => parse(qr), QrParseError);
  console.log('✓ hex-scan refuses to fabricate a DevEUI from concatenated decimal tokens');
}

/* --- hex-scan with a single 32-hex AppKey + 16-hex DevEUI --- */
{
  const qr = 'A84041035660E3AA 00112233445566778899AABBCCDDEEFF';
  const out = parse(qr);
  assert.strictEqual(out.devEui, 'A84041035660E3AA');
  assert.strictEqual(out.appKey, '00112233445566778899AABBCCDDEEFF');
  console.log('✓ hex-scan separates a DevEUI from an AppKey by length');
}

/* --- vendor info present even when OUI is unknown to KNOWN_LORAWAN_VENDORS --- */
{
  // Use an OUI that is in IEEE's registry but not in KNOWN_LORAWAN_VENDORS.
  // Apple's 00:0D:93 is in MA-L. We don't care about the keys, just vendor decode.
  const out = parse('LW:D0:0000000000000000:000D93FFFFFFFFFF:0001');
  assert.strictEqual(out.vendor.name.toLowerCase().includes('apple'), true);
  assert.strictEqual(out.vendor.knownLorawanVendor, false);
  assert.strictEqual(out.vendor.id, undefined);
  console.log('✓ vendor lookup works for non-LoRaWAN OUIs (knownLorawanVendor=false)');
}

/* --- vendor info absent when OUI is unregistered --- */
{
  const out = parse('LW:D0:0000000000000000:FEDCBAFEDCBAFEDC:0001');
  assert.strictEqual(out.vendor, undefined);
  console.log('✓ vendor field omitted when OUI is not in the registry');
}

/* --- detectVendor direct API --- */
{
  const v = detectVendor('a84041035660e3aa');
  assert.strictEqual(v.id, 'dragino');
  assert.strictEqual(v.knownLorawanVendor, true);
  assert.strictEqual(detectVendor(''), undefined);
  assert.strictEqual(detectVendor('not-hex'), undefined);
  console.log('✓ detectVendor handles uppercase/lowercase and rejects invalid input');
}

/* --- throws QrParseError on garbage --- */
{
  assert.throws(() => parse('hello world'), QrParseError);
  assert.throws(() => parse(''), QrParseError);
  assert.throws(() => parse(null), QrParseError);
  console.log('✓ unparseable input throws QrParseError');
}

/* --- attempted strategies are reported on failure --- */
{
  try {
    parse('definitely not a qr code');
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof QrParseError);
    assert.deepStrictEqual(err.attempted, ['tr005', 'lwdp', 'json', 'key-value', 'hex-scan']);
  }
  console.log('✓ QrParseError exposes the strategies that were tried');
}

/* --- known LoRaWAN vendor catalog is complete and slug-mapped --- */
{
  const ids = new Set(Object.values(KNOWN_LORAWAN_VENDORS));
  for (const expected of ['dragino', 'milesight', 'rak', 'browan', 'seeed']) {
    assert.ok(ids.has(expected), `missing known vendor: ${expected}`);
  }
  // Browan has two OUIs (Gemtek + TrackNet); both should slug to 'browan'.
  assert.strictEqual(KNOWN_LORAWAN_VENDORS.E8E1E1, 'browan');
  assert.strictEqual(KNOWN_LORAWAN_VENDORS['58A0CB'], 'browan');
  console.log('✓ KNOWN_LORAWAN_VENDORS covers the main brands (incl. both Browan OUIs)');
}

/* --- LWDP: Browan TBAM100 style URN (real device fields) --- */
{
  const qr = 'URN:LWDP:58A0CB0000210000:58A0CBFFFFFEFFFF:tbms100915:4D4483B1';
  const out = parse(qr);
  assert.strictEqual(out.source, 'lwdp');
  // LWDP puts JoinEUI first, DevEUI second — opposite of hex-scan default.
  assert.strictEqual(out.joinEui, '58A0CB0000210000');
  assert.strictEqual(out.devEui, '58A0CBFFFFFEFFFF');
  assert.deepStrictEqual(out.proprietary, { productCode: 'tbms100915', token: '4D4483B1' });
  assert.strictEqual(out.vendor.id, 'browan');
  assert.strictEqual(out.vendor.oui, '58A0CB');
  console.log('✓ LWDP strategy assigns JoinEUI first, DevEUI second (Browan format)');
}

/* --- LWDP normalizes mixed-case hex and lowercase product codes survive --- */
{
  const qr = 'URN:LWDP:58A0Cb0000210000:58A0CbFFFFFEFFFF:TBOL100868:A1B2C3D4';
  const out = parse(qr);
  assert.strictEqual(out.source, 'lwdp');
  assert.strictEqual(out.joinEui, '58A0CB0000210000');                 // hex uppercased
  assert.strictEqual(out.devEui, '58A0CBFFFFFEFFFF');
  assert.strictEqual(out.proprietary.productCode, 'TBOL100868');       // product code preserved
  console.log('✓ LWDP normalizes mixed-case hex and preserves product code casing');
}

/* --- LWDP X-placeholder template falls through to hex-scan (no false positive) --- */
{
  // The TBOL100 manual prints the format with X placeholders. The X's aren't
  // valid hex, so the LWDP strict regex correctly refuses to match — the
  // parser shouldn't pretend a template string is a real device.
  const qr = 'URN:LWDP:E8E1E10001013640:E8E1E1XXXXXXXXXX:TBOL100868:XXXXXXXX';
  const out = parse(qr);
  assert.notStrictEqual(out.source, 'lwdp');
  console.log('✓ LWDP refuses to match X-placeholder template strings');
}

console.log('ok');
