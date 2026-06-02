const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  parse, encode, encodeLwdp,
  detectVendor,
  QrParseError, QrEncodeError,
  KNOWN_LORAWAN_VENDORS,
} = require('..');

// Real-world fixture set — every DevEUI here has an OUI that maps to a real
// vendor in the IEEE registry; every AppKey is a 32-hex literal that round-trips.
const FIX = {
  draginoDevEui: 'A84041035660E3AA',
  draginoJoinEui: 'A840410000000107',
  draginoAppKey: 'A66A89B6606C1BD125B54E7CA4B10DD4',
  draginoSerial: 'DS026349738',
  milesightDevEui: '24E124136D456789',
  milesightJoinEui: '24E124C0002A0001',
  milesightAppKey: '5572404C696E6B4C6F52613230313823',
  seeedDevEui: '2CF7F1C04490010D',
  seeedJoinEui: '8FA012C179CF2BD9',
  browanJoinEui: '58A0CB0000210000',     // TrackNet (used by Browan)
  browanDevEui: '58A0CBFFFFFEFFFF',
  ttnJoinEui: '70B3D57ED0000001',
  ttnAppKey: '00112233445566778899AABBCCDDEEFF',
};

describe('parse — TR005 strategy', () => {
  test('decodes minimal LW:D0 form and identifies Dragino', () => {
    const out = parse(`LW:D0:${FIX.ttnJoinEui}:${FIX.draginoDevEui}:AB12`);
    assert.equal(out.source, 'tr005');
    assert.equal(out.devEui, FIX.draginoDevEui);
    assert.equal(out.joinEui, FIX.ttnJoinEui);
    assert.equal(out.profileId, 'AB12');
    assert.equal(out.appKey, undefined, 'TR005 never carries keys');
    assert.equal(out.vendor.id, 'dragino');
    assert.equal(out.vendor.oui, 'A84041');
  });

  test('captures owner token, serial number, and proprietary fields', () => {
    const out = parse(`LW:D0:${FIX.ttnJoinEui}:${FIX.draginoDevEui}:AB12:OWNERTOKEN:SN-0001:Pfoo=bar:Pbaz=qux`);
    assert.equal(out.ownerToken, 'OWNERTOKEN');
    assert.equal(out.serialNumber, 'SN-0001');
    assert.deepEqual(out.proprietary, { foo: 'bar', baz: 'qux' });
  });

  test('normalizes lowercase hex to uppercase', () => {
    const out = parse(`LW:D0:${FIX.ttnJoinEui.toLowerCase()}:${FIX.draginoDevEui.toLowerCase()}:ab12`);
    assert.equal(out.devEui, FIX.draginoDevEui);
    assert.equal(out.joinEui, FIX.ttnJoinEui);
    assert.equal(out.profileId, 'AB12');
  });

  test('preserves owner token casing (not normalized — opaque value)', () => {
    const out = parse(`LW:D0:${FIX.ttnJoinEui}:${FIX.draginoDevEui}:AB12:MixedCase`);
    assert.equal(out.ownerToken, 'MixedCase');
  });

  test('handles a TR005 string with only the owner token (no serial, no proprietary)', () => {
    const out = parse(`LW:D0:${FIX.ttnJoinEui}:${FIX.draginoDevEui}:AB12:OWNER`);
    assert.equal(out.ownerToken, 'OWNER');
    assert.equal(out.serialNumber, undefined);
    assert.equal(out.proprietary, undefined);
  });
});

describe('parse — LWDP strategy (Browan)', () => {
  test('assigns JoinEUI first, DevEUI second (opposite of hex-scan default)', () => {
    const qr = `URN:LWDP:${FIX.browanJoinEui}:${FIX.browanDevEui}:tbms100915:4D4483B1`;
    const out = parse(qr);
    assert.equal(out.source, 'lwdp');
    assert.equal(out.joinEui, FIX.browanJoinEui);
    assert.equal(out.devEui, FIX.browanDevEui);
    assert.deepEqual(out.proprietary, { productCode: 'tbms100915', token: '4D4483B1' });
    assert.equal(out.vendor.id, 'browan');
  });

  test('normalizes mixed-case hex but preserves product code casing', () => {
    const qr = 'URN:LWDP:58A0Cb0000210000:58A0CbFFFFFEFFFF:TBOL100868:A1B2C3D4';
    const out = parse(qr);
    assert.equal(out.joinEui, '58A0CB0000210000');
    assert.equal(out.devEui, '58A0CBFFFFFEFFFF');
    assert.equal(out.proprietary.productCode, 'TBOL100868');
  });

  test('refuses to match X-placeholder template strings (template ≠ device)', () => {
    const qr = `URN:LWDP:${FIX.browanJoinEui}:E8E1E1XXXXXXXXXX:TBOL100868:XXXXXXXX`;
    const out = parse(qr);
    assert.notEqual(out.source, 'lwdp', 'LWDP regex should reject X-placeholders');
  });
});

describe('parse — JSON strategy (Milesight-style)', () => {
  test('decodes JSON with standard DevEUI/AppEUI/AppKey keys', () => {
    const qr = JSON.stringify({
      DevEUI: FIX.milesightDevEui,
      AppEUI: FIX.milesightJoinEui,
      AppKey: FIX.milesightAppKey,
    });
    const out = parse(qr);
    assert.equal(out.source, 'json');
    assert.equal(out.devEui, FIX.milesightDevEui);
    assert.equal(out.joinEui, FIX.milesightJoinEui);
    assert.equal(out.appKey, FIX.milesightAppKey);
    assert.equal(out.vendor.id, 'milesight');
  });

  test('accepts a JSON object with both AppEUI and JoinEUI aliases', () => {
    const qr = JSON.stringify({
      devEui: FIX.draginoDevEui,
      joinEui: FIX.draginoJoinEui,
      appKey: FIX.draginoAppKey,
    });
    const out = parse(qr);
    assert.equal(out.source, 'json');
    assert.equal(out.joinEui, FIX.draginoJoinEui);
  });

  test('ignores non-credential JSON keys', () => {
    const qr = JSON.stringify({
      DevEUI: FIX.milesightDevEui,
      unrelated: 'noise',
      AppKey: FIX.milesightAppKey,
    });
    const out = parse(qr);
    assert.equal(out.devEui, FIX.milesightDevEui);
    assert.equal(out.appKey, FIX.milesightAppKey);
  });
});

describe('parse — key-value strategy', () => {
  test('decodes multi-line Dragino label format', () => {
    const qr = `DevEUI=${FIX.draginoDevEui}\nAppEUI=${FIX.draginoJoinEui}\nAppKey=${FIX.draginoAppKey}`;
    const out = parse(qr);
    assert.equal(out.source, 'key-value');
    assert.equal(out.devEui, FIX.draginoDevEui);
    assert.equal(out.joinEui, FIX.draginoJoinEui);
    assert.equal(out.appKey, FIX.draginoAppKey);
    assert.equal(out.vendor.id, 'dragino');
  });

  test('decodes comma-separated key:value form (Milesight label)', () => {
    const qr = `DevEUI:${FIX.milesightDevEui},AppKey:${FIX.milesightAppKey},AppEUI:${FIX.milesightJoinEui}`;
    const out = parse(qr);
    assert.equal(out.source, 'key-value');
    assert.equal(out.devEui, FIX.milesightDevEui);
    assert.equal(out.appKey, FIX.milesightAppKey);
  });

  test('strips colons / dashes / whitespace from byte-grouped hex values', () => {
    const qr = 'DevEUI=24:E1:24:13:6D:45:67:89\nAppKey=55:72:40:4C:69:6E:6B:4C:6F:52:61:32:30:31:38:23';
    const out = parse(qr);
    assert.equal(out.devEui, FIX.milesightDevEui);
    assert.equal(out.appKey, FIX.milesightAppKey);
  });

  test('handles case-insensitive aliases (deveui / dev_eui / dev-eui)', () => {
    const qr = `dev_eui=${FIX.draginoDevEui}\nJOIN-EUI=${FIX.draginoJoinEui}`;
    const out = parse(qr);
    assert.equal(out.devEui, FIX.draginoDevEui);
    assert.equal(out.joinEui, FIX.draginoJoinEui);
  });
});

describe('parse — hex-scan strategy', () => {
  test('recovers a bare DevEUI from dash-separated hex', () => {
    const out = parse('A8-40-41-03-56-60-E3-AA');
    assert.equal(out.source, 'hex-scan');
    assert.equal(out.devEui, FIX.draginoDevEui);
    assert.equal(out.vendor.id, 'dragino');
  });

  test('picks the known-vendor EUI as the DevEUI when both EUIs are present', () => {
    const qr = `AppEUI ${FIX.ttnJoinEui} then device ${FIX.draginoDevEui}`;
    const out = parse(qr);
    assert.equal(out.devEui, FIX.draginoDevEui, 'Dragino-OUI EUI wins over generic');
    assert.equal(out.joinEui, FIX.ttnJoinEui);
  });

  test('captures a single non-hex token as serialNumber (Dragino positional)', () => {
    const qr = `${FIX.draginoSerial};${FIX.draginoDevEui};${FIX.draginoJoinEui};${FIX.draginoAppKey}`;
    const out = parse(qr);
    assert.equal(out.source, 'hex-scan');
    assert.equal(out.devEui, FIX.draginoDevEui);
    assert.equal(out.joinEui, FIX.draginoJoinEui);
    assert.equal(out.appKey, FIX.draginoAppKey);
    assert.equal(out.serialNumber, FIX.draginoSerial);
    assert.equal(out.vendor.id, 'dragino');
  });

  test('picks the LONGEST non-hex token as serialNumber when multiple are present', () => {
    const qr = `v1 SKU-1000468 SN-99887766 ${FIX.draginoDevEui}`;
    const out = parse(qr);
    assert.equal(out.serialNumber, 'SKU-1000468');   // 11 chars, first of two ties
  });

  test('leaves serialNumber undefined when the only token is the EUI itself', () => {
    const out = parse(FIX.draginoDevEui);
    assert.equal(out.serialNumber, undefined);
  });

  test('splits a 32-hex run into DevEUI+JoinEUI when first half matches an OUI (Seeed)', () => {
    const qr = `${FIX.seeedDevEui}${FIX.seeedJoinEui}:0:1000468:114992868224900030`;
    const out = parse(qr);
    assert.equal(out.source, 'hex-scan');
    assert.equal(out.devEui, FIX.seeedDevEui);
    assert.equal(out.joinEui, FIX.seeedJoinEui);
    assert.equal(out.appKey, undefined);
    assert.equal(out.serialNumber, '114992868224900030');
    assert.equal(out.vendor.id, 'seeed');
  });

  test('refuses to fabricate a DevEUI from concatenated decimal tokens', () => {
    // Same shape as Seeed but with an unregistered OUI — should fail cleanly.
    const qr = 'FFFFFFC04490010D0000000000000000:0:1000468:114992868224900030';
    assert.throws(() => parse(qr), QrParseError);
  });

  test('separates a DevEUI from an AppKey by length when both are space-separated', () => {
    const out = parse(`${FIX.draginoDevEui} ${FIX.ttnAppKey}`);
    assert.equal(out.devEui, FIX.draginoDevEui);
    assert.equal(out.appKey, FIX.ttnAppKey);
  });
});

describe('parse — vendor identification', () => {
  test('reports vendor for non-LoRaWAN OUIs (knownLorawanVendor=false)', () => {
    // OUI 000D93 = Apple in the IEEE registry — definitely not a LoRaWAN vendor.
    const out = parse(`LW:D0:0000000000000000:000D93FFFFFFFFFF:0001`);
    assert.match(out.vendor.name.toLowerCase(), /apple/);
    assert.equal(out.vendor.knownLorawanVendor, false);
    assert.equal(out.vendor.id, undefined);
  });

  test('omits vendor when the OUI is unregistered', () => {
    const out = parse(`LW:D0:0000000000000000:FEDCBAFEDCBAFEDC:0001`);
    assert.equal(out.vendor, undefined);
  });
});

describe('parse — error handling', () => {
  test('throws QrParseError on completely unparseable input', () => {
    assert.throws(() => parse('hello world'), QrParseError);
    assert.throws(() => parse('definitely not a qr code'), QrParseError);
  });

  test('throws QrParseError on empty / nullish input', () => {
    assert.throws(() => parse(''), QrParseError);
    assert.throws(() => parse(null), QrParseError);
    assert.throws(() => parse(undefined), QrParseError);
  });

  test('QrParseError exposes the strategies that were tried', () => {
    try { parse('totally bogus'); assert.fail(); }
    catch (err) {
      assert.ok(err instanceof QrParseError);
      assert.deepEqual(err.attempted, ['tr005', 'lwdp', 'json', 'key-value', 'hex-scan']);
      assert.equal(err.raw, 'totally bogus');
    }
  });
});

describe('detectVendor', () => {
  test('resolves known LoRaWAN vendors to their slugs', () => {
    assert.equal(detectVendor(FIX.draginoDevEui).id, 'dragino');
    assert.equal(detectVendor(FIX.milesightDevEui).id, 'milesight');
    assert.equal(detectVendor(FIX.seeedDevEui).id, 'seeed');
  });

  test('handles uppercase and lowercase input identically', () => {
    const upper = detectVendor(FIX.draginoDevEui);
    const lower = detectVendor(FIX.draginoDevEui.toLowerCase());
    assert.deepEqual(upper, lower);
  });

  test('rejects invalid input gracefully', () => {
    assert.equal(detectVendor(''), undefined);
    assert.equal(detectVendor('not-hex'), undefined);
    assert.equal(detectVendor('A84041'), undefined);   // too short
  });

  test('returns undefined for an unregistered OUI', () => {
    assert.equal(detectVendor('FEDCBAFEDCBAFEDC'), undefined);
  });
});

describe('KNOWN_LORAWAN_VENDORS catalog', () => {
  test('covers the main brands', () => {
    const slugs = new Set(Object.values(KNOWN_LORAWAN_VENDORS));
    for (const expected of ['dragino', 'milesight', 'rak', 'browan', 'seeed']) {
      assert.ok(slugs.has(expected), `missing known vendor: ${expected}`);
    }
  });

  test('maps both Browan OUIs (Gemtek + TrackNet) to the same slug', () => {
    assert.equal(KNOWN_LORAWAN_VENDORS.E8E1E1, 'browan');
    assert.equal(KNOWN_LORAWAN_VENDORS['58A0CB'], 'browan');
  });

  test('all keys are uppercase 6-char hex', () => {
    for (const oui of Object.keys(KNOWN_LORAWAN_VENDORS)) {
      assert.match(oui, /^[0-9A-F]{6}$/, `bad OUI key shape: ${oui}`);
    }
  });
});

describe('encode — TR005', () => {
  test('emits minimal LW:D0 form when only required fields are given', () => {
    const out = encode({
      devEui: FIX.draginoDevEui,
      joinEui: FIX.ttnJoinEui,
      profileId: 'AB12',
    });
    assert.equal(out, `LW:D0:${FIX.ttnJoinEui}:${FIX.draginoDevEui}:AB12`);
  });

  test('normalizes lowercase and byte-grouped hex on the way in', () => {
    const out = encode({
      devEui: 'a8-40-41-03-56-60-e3-aa',
      joinEui: '70:B3:D5:7E:D0:00:00:01',
      profileId: 'ab12',
    });
    assert.equal(out, `LW:D0:${FIX.ttnJoinEui}:${FIX.draginoDevEui}:AB12`);
  });

  test('includes owner token, serial, and proprietary fields when supplied', () => {
    const out = encode({
      devEui: FIX.draginoDevEui,
      joinEui: FIX.ttnJoinEui,
      profileId: 'AB12',
      ownerToken: 'OWNER123',
      serialNumber: 'SN0001',
      proprietary: { foo: 'bar', baz: 'qux' },
    });
    assert.equal(out, `LW:D0:${FIX.ttnJoinEui}:${FIX.draginoDevEui}:AB12:OWNER123:SN0001:Pfoo=bar:Pbaz=qux`);
  });

  test('emits empty positional slots when only proprietary fields follow', () => {
    const out = encode({
      devEui: FIX.draginoDevEui,
      joinEui: FIX.ttnJoinEui,
      profileId: 'AB12',
      proprietary: { foo: 'bar' },
    });
    // owner + serial positional slots are empty but present so the parser can walk past them.
    assert.equal(out, `LW:D0:${FIX.ttnJoinEui}:${FIX.draginoDevEui}:AB12:::Pfoo=bar`);
  });

  test('emits empty trailing positional slot when only serial follows', () => {
    const out = encode({
      devEui: FIX.draginoDevEui,
      joinEui: FIX.ttnJoinEui,
      profileId: 'AB12',
      serialNumber: 'SN1',
    });
    // owner is empty, serial follows.
    assert.equal(out, `LW:D0:${FIX.ttnJoinEui}:${FIX.draginoDevEui}:AB12::SN1`);
  });

  test('round-trips: parse(encode(input)) recovers every field', () => {
    const input = {
      devEui: FIX.draginoDevEui,
      joinEui: FIX.ttnJoinEui,
      profileId: 'AB12',
      ownerToken: 'OWNER123',
      serialNumber: 'SN0001',
      proprietary: { foo: 'bar' },
    };
    const parsed = parse(encode(input));
    assert.equal(parsed.source, 'tr005');
    assert.equal(parsed.devEui, input.devEui);
    assert.equal(parsed.joinEui, input.joinEui);
    assert.equal(parsed.profileId, input.profileId);
    assert.equal(parsed.ownerToken, input.ownerToken);
    assert.equal(parsed.serialNumber, input.serialNumber);
    assert.deepEqual(parsed.proprietary, input.proprietary);
  });

  describe('validation', () => {
    test('rejects non-hex DevEUI', () => {
      assert.throws(
        () => encode({ devEui: 'bad', joinEui: FIX.ttnJoinEui, profileId: 'AB12' }),
        err => err instanceof QrEncodeError && err.field === 'devEui',
      );
    });

    test('rejects non-hex JoinEUI', () => {
      assert.throws(
        () => encode({ devEui: FIX.draginoDevEui, joinEui: 'bad', profileId: 'AB12' }),
        err => err instanceof QrEncodeError && err.field === 'joinEui',
      );
    });

    test('rejects profileId of wrong length', () => {
      assert.throws(
        () => encode({ devEui: FIX.draginoDevEui, joinEui: FIX.ttnJoinEui, profileId: 'ABCDE' }),
        err => err instanceof QrEncodeError && err.field === 'profileId',
      );
      assert.throws(
        () => encode({ devEui: FIX.draginoDevEui, joinEui: FIX.ttnJoinEui, profileId: 'ABC' }),
        QrEncodeError,
      );
    });

    test('rejects ownerToken containing a colon (TR005 field separator)', () => {
      assert.throws(
        () => encode({ devEui: FIX.draginoDevEui, joinEui: FIX.ttnJoinEui, profileId: 'AB12', ownerToken: 'has:colon' }),
        err => err instanceof QrEncodeError && err.field === 'ownerToken',
      );
    });

    test('rejects serialNumber containing a colon', () => {
      assert.throws(
        () => encode({ devEui: FIX.draginoDevEui, joinEui: FIX.ttnJoinEui, profileId: 'AB12', serialNumber: 'has:colon' }),
        err => err instanceof QrEncodeError && err.field === 'serialNumber',
      );
    });

    test('rejects proprietary keys containing reserved chars', () => {
      assert.throws(
        () => encode({ devEui: FIX.draginoDevEui, joinEui: FIX.ttnJoinEui, profileId: 'AB12', proprietary: { 'bad=key': 'v' } }),
        err => err instanceof QrEncodeError && err.field === 'proprietary',
      );
      assert.throws(
        () => encode({ devEui: FIX.draginoDevEui, joinEui: FIX.ttnJoinEui, profileId: 'AB12', proprietary: { 'bad:key': 'v' } }),
        QrEncodeError,
      );
    });

    test('rejects proprietary values containing colons', () => {
      assert.throws(
        () => encode({ devEui: FIX.draginoDevEui, joinEui: FIX.ttnJoinEui, profileId: 'AB12', proprietary: { k: 'val:with:colon' } }),
        QrEncodeError,
      );
    });

    test('QrEncodeError exposes which field failed', () => {
      try {
        encode({ devEui: 'bad', joinEui: FIX.ttnJoinEui, profileId: 'AB12' });
        assert.fail('expected throw');
      } catch (err) {
        assert.ok(err instanceof QrEncodeError);
        assert.equal(err.field, 'devEui');
      }
    });
  });
});

describe('encodeLwdp — Browan URN', () => {
  test('emits canonical form with JoinEUI first', () => {
    const out = encodeLwdp({
      joinEui: FIX.browanJoinEui,
      devEui: FIX.browanDevEui,
      productCode: 'tbms100915',
      token: '4D4483B1',
    });
    assert.equal(out, `URN:LWDP:${FIX.browanJoinEui}:${FIX.browanDevEui}:tbms100915:4D4483B1`);
  });

  test('round-trips with parse: recovers all fields incl. Browan vendor slug', () => {
    const input = {
      joinEui: FIX.browanJoinEui,
      devEui: FIX.browanDevEui,
      productCode: 'tbms100915',
      token: '4D4483B1',
    };
    const parsed = parse(encodeLwdp(input));
    assert.equal(parsed.source, 'lwdp');
    assert.equal(parsed.joinEui, input.joinEui);
    assert.equal(parsed.devEui, input.devEui);
    assert.deepEqual(parsed.proprietary, { productCode: input.productCode, token: input.token });
    assert.equal(parsed.vendor.id, 'browan');
  });

  test('normalizes hex but preserves product code casing', () => {
    const out = encodeLwdp({
      joinEui: '58a0cb0000210000',
      devEui: '58a0cbffffefffff'.toUpperCase().replace(/F/g, 'F'),  // FFFFEFFFFF == FFFFEFFFFF
      productCode: 'TBOL100868',
      token: 'a1b2c3d4',
    });
    assert.match(out, /^URN:LWDP:58A0CB0000210000:/);
    assert.match(out, /:TBOL100868:A1B2C3D4$/);
  });

  describe('validation', () => {
    test('rejects bad hex JoinEUI', () => {
      assert.throws(() => encodeLwdp({
        joinEui: 'bad', devEui: FIX.browanDevEui, productCode: 'tbms100915', token: '4D4483B1',
      }), err => err instanceof QrEncodeError && err.field === 'joinEui');
    });

    test('rejects bad hex DevEUI', () => {
      assert.throws(() => encodeLwdp({
        joinEui: FIX.browanJoinEui, devEui: 'bad', productCode: 'tbms100915', token: '4D4483B1',
      }), err => err instanceof QrEncodeError && err.field === 'devEui');
    });

    test('rejects non-alphanumeric product codes', () => {
      assert.throws(() => encodeLwdp({
        joinEui: FIX.browanJoinEui, devEui: FIX.browanDevEui, productCode: 'has-dash', token: '4D4483B1',
      }), err => err instanceof QrEncodeError && err.field === 'productCode');
    });

    test('rejects product code longer than 20 chars', () => {
      assert.throws(() => encodeLwdp({
        joinEui: FIX.browanJoinEui, devEui: FIX.browanDevEui,
        productCode: 'a'.repeat(21), token: '4D4483B1',
      }), QrEncodeError);
    });

    test('rejects non-hex or too-short tokens', () => {
      assert.throws(() => encodeLwdp({
        joinEui: FIX.browanJoinEui, devEui: FIX.browanDevEui, productCode: 'tbms100915', token: 'ZZ',
      }), err => err instanceof QrEncodeError && err.field === 'token');
      assert.throws(() => encodeLwdp({
        joinEui: FIX.browanJoinEui, devEui: FIX.browanDevEui, productCode: 'tbms100915', token: 'AB',
      }), QrEncodeError);   // 2-char token is too short (min 4)
    });
  });
});
