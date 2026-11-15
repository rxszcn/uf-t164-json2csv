import {
  number as numberFormatter,
  stringExcel as stringExcelFormatter,
  string as stringFormatter,
  stringQuoteOnlyIfNecessary as stringQuoteOnlyIfNecessaryFormatter,
} from '@json2csv/formatters';
import { Parser, type ParserOptions } from '@json2csv/plainjs';
import { fixtures } from '@json2csv/test-helpers/fixtureLoader.ts';
import type CarInfo from '@json2csv/test-helpers/fixtures/types/carInfo.ts';
import { forceCrlfEol } from '@json2csv/test-helpers/utils.ts';
import { flatten, unwind } from '@json2csv/transforms';
import { beforeAll, describe, expect, it } from 'vitest';

let jsonFixtures: Record<string, () => any>;
let csvFixtures: Record<string, string>;

beforeAll(async () => {
  const loaded = await fixtures;
  jsonFixtures = loaded.jsonFixtures;
  csvFixtures = loaded.csvFixturesWithLinuxEol;
});

async function parseInput<TRaw extends object, T extends object>(
  parser: Parser<TRaw, T>,
  nodeStream: TRaw,
): Promise<string> {
  return parser.parse(nodeStream);
}

describe('Parser', () => {
  it('should not modify the JSON object passed passed', async () => {
    const opts: ParserOptions = {
      fields: [
        'carModel',
        'price',
        'extras.items.name',
        'extras.items.items.position',
        'extras.items.items.color',
        'extras.items.color',
      ],
      transforms: [
        unwind({ paths: ['extras.items', 'extras.items.items'] }),
        flatten(),
      ],
    };
    const originalJson = JSON.parse(
      JSON.stringify(jsonFixtures.unwindComplexObject()),
    );

    const parser = new Parser(opts);
    const csv = await parseInput(parser, originalJson);

    expect(csv).toBe(csvFixtures.unwindComplexObject);
    expect(jsonFixtures.unwindComplexObject()).toEqual(originalJson);
  });

  it('should not modify the opts passed', async () => {
    const opts: ParserOptions = {};
    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.default);
    expect(opts).toEqual({});
  });

  it('should error if input data is empty and fields are not set', async () => {
    const parser = new Parser();
    await expect(
      parseInput(parser, jsonFixtures.empty() || undefined),
    ).rejects.toThrow(
      'Data should not be empty or the "fields" option should be included',
    );
  });

  it('should error if input data is single item and not an object', async () => {
    const parser = new Parser();
    await expect(
      parseInput(parser, jsonFixtures.notObjectSingleItem()),
    ).rejects.toThrow(
      'Data items should be objects or the "fields" option should be included',
    );
  });

  it('should error if input data is not an object', async () => {
    const parser = new Parser();
    await expect(
      parseInput(parser, jsonFixtures.notObjectArray()),
    ).rejects.toThrow(
      'Data items should be objects or the "fields" option should be included',
    );
  });

  it('should error, not crash, if an array element is null and fields are not set', async () => {
    // typeof null === 'object', so a naive `typeof x !== 'object'` guard lets
    // null through, and it later throws a raw, unhelpful TypeError from
    // Object.keys(null) instead of this descriptive error.
    const parser = new Parser();
    await expect(
      parseInput(parser, jsonFixtures.nullArrayElement()),
    ).rejects.toThrow(
      'Data items should be objects or the "fields" option should be included',
    );
  });

  it('should handle empty object', async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'color'],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.emptyObject());

    expect(csv).toBe(csvFixtures.emptyObject);
  });

  it('should handle empty array', async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'color'],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.emptyArray());

    expect(csv).toBe(csvFixtures.emptyObject);
  });

  it('should handle array with nulls', async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'color'],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.arrayWithNull());

    expect(csv).toBe(csvFixtures.emptyObject);
  });

  it('should handle deep JSON objects', async () => {
    const parser = new Parser();
    const csv = await parseInput(parser, jsonFixtures.deepJSON());

    expect(csv).toBe(csvFixtures.deepJSON);
  });

  it('should parse json to csv and infer the fields automatically ', async () => {
    const parser = new Parser();
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.default);
  });

  it('should parse json to csv using custom fields', async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'color', 'manual'],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.default);
  });

  it('should output only selected fields', async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price'],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.selected);
  });

  it('should output fields in the order provided', async () => {
    const opts: ParserOptions = {
      fields: ['price', 'carModel'],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.reversed);
  });

  it('should output empty value for non-existing fields', async () => {
    const opts: ParserOptions = {
      fields: [
        'first not exist field',
        'carModel',
        'price',
        'not exist field',
        'color',
      ],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.withNotExistField);
  });

  it("should name columns as specified in 'fields' property", async () => {
    const opts: ParserOptions = {
      fields: [
        {
          label: 'Car Model',
          value: 'carModel',
        },
        {
          label: 'Price USD',
          value: 'price',
        },
      ],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.fieldNames);
  });

  it("should error on invalid 'fields' property", () => {
    const opts: ParserOptions = {
      fields: [
        { value: 'price' },
        // @ts-expect-error test for non TS users. Wrong type expected
        () => {
          /* Do nothing */
        },
      ],
    };

    expect(() => new Parser(opts)).toThrow(
      `Invalid field info option. ${JSON.stringify(opts.fields![1])}`,
    );
  });

  it("should error on invalid 'fields.value' property", () => {
    const opts: ParserOptions<CarInfo> = {
      fields: [
        { value: (row: CarInfo) => row.price },
        // @ts-expect-error test for non TS users. Wrong type expected
        { label: 'Price USD', value: [] },
      ],
    };

    expect(() => new Parser(opts)).toThrow(
      `Invalid field info option. ${JSON.stringify(opts.fields![1])}`,
    );
  });

  it('should support nested properties selectors', async () => {
    const opts: ParserOptions = {
      fields: [
        {
          label: 'Make',
          value: 'car.make',
        },
        {
          label: 'Model',
          value: 'car.model',
        },
        {
          label: 'Price',
          value: 'prices[0]',
        },
        {
          label: 'Color',
          value: 'color',
        },
        {
          label: 'Year',
          value: 'car.ye.ar',
        },
      ],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.nested());

    expect(csv).toBe(csvFixtures.nested);
  });

  it('should support nested properties selectors using braket notation', async () => {
    const opts: ParserOptions = {
      fields: [
        {
          label: 'Make',
          value: 'car[make]',
        },
        {
          label: 'Model',
          value: 'car["model"]',
        },
        {
          label: 'Price',
          value: 'prices[0]',
        },
        {
          label: 'Color',
          value: 'color',
        },
        {
          label: 'Year',
          value: "car['ye'][ar]",
        },
      ],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.nested());

    expect(csv).toBe(csvFixtures.nested);
  });

  it('should prefer exact field names over nested property selectors', async () => {
    const parser = new Parser({
      fields: ['nested.value', { label: 'Bracket', value: 'nested["value"]' }],
    });
    const csv = parser.parse([
      {
        'nested.value': 'literal dot',
        'nested["value"]': 'literal bracket',
        nested: { value: 'nested' },
      },
      { nested: { value: 'nested' } },
    ]);

    expect(csv).toBe(
      [
        '"nested.value","Bracket"',
        '"literal dot","literal bracket"',
        '"nested","nested"',
      ].join('\n'),
    );
  });

  it('field.value function should receive a valid field object', async () => {
    let receivedField: any;
    const opts: ParserOptions<{ value1: any }> = {
      fields: [
        {
          label: 'Value1',
          default: 'default value',
          value: (row, field) => {
            receivedField = field;
            return row.value1.toLocaleString();
          },
        },
      ],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(
      parser,
      jsonFixtures.functionStringifyByDefault(),
    );

    expect(receivedField).toEqual({
      label: 'Value1',
      default: 'default value',
    });
    expect(csv).toBe(csvFixtures.functionStringifyByDefault);
  });

  it('field.value function should stringify results by default', async () => {
    const opts: ParserOptions<{ value1: any }> = {
      fields: [
        {
          label: 'Value1',
          value: (row: { value1: any }) => row.value1.toLocaleString(),
        },
      ],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(
      parser,
      jsonFixtures.functionStringifyByDefault(),
    );

    expect(csv).toBe(csvFixtures.functionStringifyByDefault);
  });

  it('should process different combinations in fields option', async () => {
    const opts: ParserOptions = {
      fields: [
        {
          label: 'PATH1',
          value: 'path1',
        },
        {
          label: 'PATH1+PATH2',
          value: (row: any) => row.path1 + row.path2,
        },
        {
          label: 'NEST1',
          value: 'bird.nest1',
        },
        'bird.nest2',
        {
          label: 'nonexistent',
          value: 'fake.path',
          default: 'col specific default value',
        },
      ],
      defaultValue: 'NULL',
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.fancyfields());

    expect(csv).toBe(csvFixtures.fancyfields);
  });

  // Default value

  it("should output the default value as set in 'defaultValue'", async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price'],
      defaultValue: '',
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.defaultValueEmpty());

    expect(csv).toBe(csvFixtures.defaultValueEmpty);
  });

  it("should override 'options.defaultValue' with 'field.defaultValue'", async () => {
    const opts: ParserOptions = {
      fields: [
        { value: 'carModel' },
        { value: 'price', default: 1 },
        { value: 'color' },
      ],
      defaultValue: '',
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.overriddenDefaultValue());

    expect(csv).toBe(csvFixtures.overriddenDefaultValue);
  });

  it("should use 'options.defaultValue' when no 'field.defaultValue'", async () => {
    const opts: ParserOptions<CarInfo> = {
      fields: [
        {
          value: 'carModel',
        },
        {
          label: 'price',
          value: (row: CarInfo) => row.price,
          default: 1,
        },
        {
          label: 'color',
          value: (row: CarInfo) => row.color,
        },
      ],
      defaultValue: '',
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.overriddenDefaultValue());

    expect(csv).toBe(csvFixtures.overriddenDefaultValue);
  });

  // Delimiter

  it("should use a custom delimiter when 'delimiter' property is defined", async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'color'],
      delimiter: '\t',
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.tsv);
  });

  it('should remove last delimiter |@|', async () => {
    const opts: ParserOptions = { delimiter: '|@|' };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.delimiter());

    expect(csv).toBe(csvFixtures.delimiter);
  });

  // EOL

  it("should use a custom eol character when 'eol' property is present", async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'color'],
      eol: '\r\n',
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(forceCrlfEol(csvFixtures.eol));
  });

  // Header

  it('should parse json to csv without column title', async () => {
    const opts: ParserOptions = {
      header: false,
      fields: ['carModel', 'price', 'color', 'manual'],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.withoutHeader);
  });

  // Include empty rows

  it('should not include empty rows when options.includeEmptyRows is not specified', async () => {
    const parser = new Parser();
    const csv = await parseInput(parser, jsonFixtures.emptyRow());

    expect(csv).toBe(csvFixtures.emptyRowNotIncluded);
  });

  it('should include empty rows when options.includeEmptyRows is true', async () => {
    const opts: ParserOptions = {
      includeEmptyRows: true,
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.emptyRow());

    expect(csv).toBe(csvFixtures.emptyRow);
  });

  it('should include a single-field empty row when options.includeEmptyRows is true', async () => {
    // With exactly one field, an included empty row's joined line is the
    // empty string itself (no delimiter to keep it non-empty). A naive
    // `.filter((row) => row)` treats that falsy '' the same as a skipped
    // (undefined) row and drops it, contradicting includeEmptyRows: true.
    const opts: ParserOptions = {
      fields: ['value'],
      includeEmptyRows: true,
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.singleFieldEmptyRow());

    expect(csv).toBe(csvFixtures.singleFieldEmptyRowIncluded);
  });

  it('should not include a single-field empty row when options.includeEmptyRows is false', async () => {
    const opts: ParserOptions = {
      fields: ['value'],
      includeEmptyRows: false,
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.singleFieldEmptyRow());

    expect(csv).toBe(csvFixtures.singleFieldEmptyRowNotIncluded);
  });

  it('should not include empty rows when options.includeEmptyRows is false', async () => {
    const opts: ParserOptions = {
      includeEmptyRows: false,
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.emptyRow());

    expect(csv).toBe(csvFixtures.emptyRowNotIncluded);
  });

  it('should include empty rows when options.includeEmptyRows is true, with default values', async () => {
    const opts: ParserOptions = {
      fields: [
        {
          value: 'carModel',
        },
        {
          value: 'price',
          default: 1,
        },
        {
          value: 'color',
        },
      ],
      defaultValue: 'NULL',
      includeEmptyRows: true,
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.emptyRow());

    expect(csv).toBe(csvFixtures.emptyRowDefaultValues);
  });

  it('should parse data:[null] to csv with only column title, despite options.includeEmptyRows', async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'color'],
      includeEmptyRows: true,
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.arrayWithNull());

    expect(csv).toBe(csvFixtures.emptyObject);
  });

  // BOM

  it('should add BOM character', async () => {
    const opts: ParserOptions = {
      withBOM: true,
      fields: ['carModel', 'price', 'color', 'manual'],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.specialCharacters());

    expect(csv[0]).toBe('\ufeff');
    expect(csv.length).toBe(csvFixtures.default.length + 1);
    expect(csv.length).toBe(csvFixtures.withBOM.length);
  });

  // Transforms

  it('should unwind all unwindable fields using the unwind transform', async () => {
    const opts: ParserOptions = {
      fields: [
        'carModel',
        'price',
        'extras.items.name',
        'extras.items.color',
        'extras.items.items.position',
        'extras.items.items.color',
      ],
      transforms: [unwind()],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.unwind2());

    expect(csv).toBe(csvFixtures.unwind2);
  });

  it('should support unwinding specific fields using the unwind transform', async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'colors'],
      transforms: [unwind({ paths: ['colors'] })],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.unwind());

    expect(csv).toBe(csvFixtures.unwind);
  });

  it('should support multi-level unwind using the unwind transform', async () => {
    const opts: ParserOptions = {
      fields: [
        'carModel',
        'price',
        'extras.items.name',
        'extras.items.color',
        'extras.items.items.position',
        'extras.items.items.color',
      ],
      transforms: [unwind({ paths: ['extras.items', 'extras.items.items'] })],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.unwind2());

    expect(csv).toBe(csvFixtures.unwind2);
  });

  it('should support unwind and blank out repeated data using the unwind transform', async () => {
    const opts: ParserOptions = {
      fields: [
        'carModel',
        'price',
        'extras.items.name',
        'extras.items.color',
        'extras.items.items.position',
        'extras.items.items.color',
      ],
      transforms: [
        unwind({
          paths: ['extras.items', 'extras.items.items'],
          blankOut: true,
        }),
      ],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.unwind2());

    expect(csv).toBe(csvFixtures.unwind2Blank);
  });

  it('should support flattening deep JSON using the flatten transform', async () => {
    const opts: ParserOptions = {
      transforms: [flatten()],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.deepJSON());

    expect(csv).toBe(csvFixtures.flattenedDeepJSON);
  });

  it('should support flattening JSON with nested arrays using the flatten transform', async () => {
    const opts: ParserOptions = {
      transforms: [flatten({ arrays: true })],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.flattenArrays());

    expect(csv).toBe(csvFixtures.flattenedArrays);
  });

  it('should consistently drop empty arrays and empty objects instead of keeping only one, using the flatten transform', async () => {
    const opts: ParserOptions = {
      fields: ['name', 'tags', 'tags.0', 'tags.1', 'address', 'address.city'],
      transforms: [flatten({ arrays: true, objects: true })],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.flattenEmptyArray());

    expect(csv).toBe(csvFixtures.flattenedEmptyArray);
  });

  it('should support custom flatten separator using the flatten transform', async () => {
    const opts: ParserOptions = {
      transforms: [flatten({ separator: '__' })],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.deepJSON());

    expect(csv).toBe(csvFixtures.flattenedCustomSeparatorDeepJSON);
  });

  it('should support custom flatten separator using the flatten transform for arrays and objects', async () => {
    const opts: ParserOptions = {
      delimiter: ';',
      transforms: [flatten({ separator: '.', arrays: true, objects: true })],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.objectWithEmptyFields());

    expect(csv).toBe(csvFixtures.objectWithEmptyFields);
  });

  it('should resolve flattened key collisions independently of the row key order (flat key vs nested object)', () => {
    // The literal `user.id` key and the nested `user: { id }` object both
    // flatten to `user.id`. Whichever order the keys are inserted in, the
    // same source path must win and the exported CSV must be identical.
    const flatFirst = { 'user.id': 'flat', user: { id: 'nested' }, kept: 1 };
    const nestedFirst = { kept: 1, user: { id: 'nested' }, 'user.id': 'flat' };

    const parser = new Parser({ transforms: [flatten()] });

    const flatFirstCsv = parser.parse([flatFirst]);
    const nestedFirstCsv = parser.parse([nestedFirst]);

    expect(flatFirstCsv).toBe(nestedFirstCsv);
    expect(flatFirstCsv).toBe('"kept","user.id"\n1,"nested"');
  });

  it('should also produce the same flattened row object for reversed key insertion order', () => {
    const flatFirst = { 'user.id': 'flat', user: { id: 'nested' }, kept: 1 };
    const nestedFirst = { kept: 1, user: { id: 'nested' }, 'user.id': 'flat' };

    expect(flatten()(flatFirst)).toEqual(flatten()(nestedFirst));
    expect(JSON.stringify(flatten()(flatFirst))).toBe(
      JSON.stringify(flatten()(nestedFirst)),
    );
  });

  it('should resolve flattened key collisions independently of the row key order (flat key vs nested array)', () => {
    const flatFirst = { 'items.0': 'flat', items: ['nested'], kept: 2 };
    const nestedFirst = { kept: 2, items: ['nested'], 'items.0': 'flat' };

    const parser = new Parser({ transforms: [flatten({ arrays: true })] });

    const flatFirstCsv = parser.parse([flatFirst]);
    const nestedFirstCsv = parser.parse([nestedFirst]);

    expect(flatFirstCsv).toBe(nestedFirstCsv);
    expect(flatFirstCsv).toBe('"items.0","kept"\n"nested",2');
  });

  it('should resolve multiple flattened key collisions deterministically regardless of row key order', () => {
    const first = {
      'x.y': 1,
      x: { y: 2 },
      'x.y.z': 3,
      x2: { y: { z: 4 } },
    };
    const second = {
      x2: { y: { z: 4 } },
      'x.y.z': 3,
      x: { y: 2 },
      'x.y': 1,
    };

    // Fields are pinned so the comparison isolates conflict resolution from
    // the pre-existing first-seen column order of non-conflicting keys.
    const opts: ParserOptions = {
      fields: ['x.y', 'x.y.z', 'x2.y.z'],
      transforms: [flatten()],
    };

    expect(new Parser(opts).parse([first])).toBe(
      new Parser(opts).parse([second]),
    );
  });

  it('should emit the same flattened row (values and column order) for any key insertion order once a collision exists', () => {
    const row = {
      'user.id': 'flat',
      user: { id: 'nested', name: 'Jack' },
      record: 'r1',
    };
    const orders = [
      row,
      { record: 'r1', user: { name: 'Jack', id: 'nested' }, 'user.id': 'flat' },
      { user: { id: 'nested', name: 'Jack' }, 'user.id': 'flat', record: 'r1' },
      { 'user.id': 'flat', record: 'r1', user: { name: 'Jack', id: 'nested' } },
    ];

    const expected = flatten()(row);
    expect(Object.keys(expected)).toEqual(['record', 'user.id', 'user.name']);

    for (const ordered of orders) {
      expect(JSON.stringify(flatten()(ordered))).toBe(
        JSON.stringify(expected),
      );
    }
  });

  it('should keep the pre-existing first-seen column order when there is no collision', () => {
    const row = { z: 1, a: { b: 2 }, tail: 'end' };

    expect(Object.keys(flatten()(row) as object)).toEqual(['z', 'a.b', 'tail']);
  });

  it('should support choosing which source path wins a flattened key collision', () => {
    const row = { 'user.id': 'flat', user: { id: 'nested' } };

    expect(new Parser({ transforms: [flatten()] }).parse([row])).toBe(
      '"user.id"\n"nested"',
    );
    expect(
      new Parser({
        transforms: [flatten({ onConflict: 'first' })],
      }).parse([row]),
    ).toBe('"user.id"\n"nested"');
    expect(
      new Parser({
        transforms: [flatten({ onConflict: 'last' })],
      }).parse([row]),
    ).toBe('"user.id"\n"flat"');
  });

  it('should error on flattened key collisions when the onConflict strategy is "error"', () => {
    const parser = new Parser({
      transforms: [flatten({ onConflict: 'error' })],
    });

    expect(() =>
      parser.parse([{ 'user.id': 'flat', user: { id: 'nested' } }]),
    ).toThrow(/Flatten conflict: "user\.id"/);
  });

  it('should reject an invalid onConflict strategy', () => {
    expect(() => flatten({ onConflict: 'unknown' as any })).toThrow(
      /Invalid flatten "onConflict" option/,
    );
  });

  it('should flatten the same logical record identically for both key insertion orders (flat keys first vs nested keys first)', async () => {
    const opts: ParserOptions = {
      transforms: [flatten({ arrays: true, objects: true })],
    };

    const parser = new Parser(opts);
    const flatFirstCsv = await parseInput(
      parser,
      jsonFixtures.flattenConflictFlatFirst(),
    );
    // A new parser is used because field auto-detection is captured on the
    // first parse call.
    const nestedFirstCsv = await parseInput(
      new Parser(opts),
      jsonFixtures.flattenConflictNestedFirst(),
    );

    expect(flatFirstCsv).toBe(csvFixtures.flattenedConflictDeterministic);
    expect(nestedFirstCsv).toBe(csvFixtures.flattenedConflictDeterministic);
  });

  it('should let the deepest source path win flattened key collisions with onConflict "last"', async () => {
    const parser = new Parser({
      transforms: [flatten({ arrays: true, objects: true, onConflict: 'last' })],
    });

    const csv = await parseInput(
      parser,
      jsonFixtures.flattenConflictFlatFirst(),
    );

    expect(csv).toBe(csvFixtures.flattenedConflictLast);
  });

  it('should error on flattened key collisions with onConflict "error" and keep reporting all clashing source paths', async () => {
    const parser = new Parser({
      transforms: [flatten({ arrays: true, objects: true, onConflict: 'error' })],
    });

    await expect(
      parseInput(parser, jsonFixtures.flattenConflictFlatFirst()),
    ).rejects.toThrow(/Flatten conflict: "tags\.0".*"user\.id"/s);
  });

  it('should not alter non-conflicting flattened keys or their order', () => {
    const parser = new Parser({
      transforms: [flatten({ arrays: true, objects: true })],
    });

    const row = {
      z: 1,
      a: { b: 2 },
      list: [{ c: 3 }],
      tail: 'end',
    };

    expect(parser.parse([row])).toBe(
      '"z","a.b","list.0.c","tail"\n1,2,3,"end"',
    );
  });

  it('should support multiple transforms and honor the order in which they are declared', async () => {
    const opts: ParserOptions = {
      transforms: [unwind({ paths: ['items'] }), flatten()],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.unwindAndFlatten());

    expect(csv).toBe(csvFixtures.unwindAndFlatten);
  });

  it('should unwind complex objects using the unwind transform', async () => {
    const opts: ParserOptions = {
      fields: [
        'carModel',
        'price',
        'extras.items.name',
        'extras.items.items.position',
        'extras.items.items.color',
        'extras.items.color',
      ],
      transforms: [
        unwind({ paths: ['extras.items', 'extras.items.items'] }),
        flatten(),
      ],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.unwindComplexObject());

    expect(csv).toBe(csvFixtures.unwindComplexObject);
  });

  it('should support custom transforms', async () => {
    interface TransformedCarInfo {
      model: string;
      price: number;
      color: string;
      manual: 'automatic' | 'manual';
    }

    const opts: ParserOptions<CarInfo, TransformedCarInfo> = {
      transforms: [
        (row) => ({
          model: row.carModel,
          price: row.price / 1000,
          color: row.color,
          manual: row.manual || 'automatic',
        }),
      ],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.defaultCustomTransform);
  });

  // Formatters - Number

  it("should used a custom separator when 'decimals' is passed to the number formatter", async () => {
    const opts: ParserOptions = {
      formatters: {
        number: numberFormatter({ decimals: 2 }),
      },
    };
    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.numberFormatter());

    expect(csv).toBe(csvFixtures.numberFixedDecimals);
  });

  it("should used a custom separator when 'separator' is passed to the number formatter", async () => {
    const opts: ParserOptions = {
      delimiter: ';',
      formatters: {
        number: numberFormatter({ separator: ',' }),
      },
    };
    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.numberFormatter());

    expect(csv).toBe(csvFixtures.numberCustomSeparator);
  });

  it("should used a custom separator and fixed number of decimals when 'separator' and 'decimals' are passed to the number formatter", async () => {
    const opts: ParserOptions = {
      delimiter: ';',
      formatters: {
        number: numberFormatter({ separator: ',', decimals: 2 }),
      },
    };
    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.numberFormatter());

    expect(csv).toBe(csvFixtures.numberFixedDecimalsAndCustomSeparator);
  });

  it("should format with zero decimals when 'decimals' is 0", async () => {
    // `decimals: 0` is falsy, so a naive `if (decimals)` check silently
    // skipped toFixed(0) and left the raw value unrounded.
    const opts: ParserOptions = {
      formatters: {
        number: numberFormatter({ decimals: 0 }),
      },
    };
    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.numberFormatter());

    expect(csv).toBe(csvFixtures.numberZeroDecimals);
  });

  // Symbol

  it('should format Symbol by its name', async () => {
    const parser = new Parser({});
    const csv = await parseInput(parser, jsonFixtures.symbol());

    expect(csv).toBe(csvFixtures.symbol);
  });

  // String Quote

  it("should use a custom quote when 'quote' property is present", async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price'],
      formatters: {
        string: stringFormatter({ quote: "'" }),
      },
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.withSimpleQuotes);
  });

  it("should be able to don't output quotes when setting 'quote' to empty string", async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price'],
      formatters: {
        string: stringFormatter({ quote: '' }),
      },
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.withoutQuotes);
  });

  it("should escape quotes when setting 'quote' property is present", async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'color'],
      formatters: {
        string: stringFormatter({ quote: "'" }),
      },
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.escapeCustomQuotes());

    expect(csv).toBe(csvFixtures.escapeCustomQuotes);
  });

  it('should treat a regex-special quote character as a literal string', async () => {
    // "." is "any character" in a regex; a previous implementation built
    // `new RegExp(quote, 'g')`, which corrupted every character in the value.
    const opts: ParserOptions = {
      fields: ['text'],
      formatters: {
        string: stringFormatter({ quote: '.', escapedQuote: '..' }),
      },
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.regexSpecialQuoteChar());

    expect(csv).toBe(csvFixtures.regexSpecialQuoteChar);
  });

  it('should not throw for a quote that would be an invalid regex pattern', async () => {
    // An unbalanced "(" used to throw a SyntaxError from `new RegExp(...)`.
    const opts: ParserOptions = {
      fields: ['text'],
      formatters: {
        string: stringFormatter({ quote: '(', escapedQuote: '((' }),
      },
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.invalidRegexQuoteChar());

    expect(csv).toBe(csvFixtures.invalidRegexQuoteChar);
  });

  it("should not escape '\"' when setting 'quote' set to something else", async () => {
    const opts: ParserOptions = {
      formatters: {
        string: stringFormatter({ quote: "'" }),
      },
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.escapedQuotes());

    expect(csv).toBe(csvFixtures.escapedQuotesUnescaped);
  });

  // String Escaped Quote

  it('should escape quotes with double quotes', async () => {
    const parser = new Parser();
    const csv = await parseInput(parser, jsonFixtures.quotes());

    expect(csv).toBe(csvFixtures.quotes);
  });

  it('should not escape quotes with double quotes, when there is a backslash in the end', async () => {
    const parser = new Parser();
    const csv = await parseInput(parser, jsonFixtures.backslashAtEnd());

    expect(csv).toBe(csvFixtures.backslashAtEnd);
  });

  it('should not escape quotes with double quotes, when there is a backslash in the end, and its not the last column', async () => {
    const parser = new Parser();
    const csv = await parseInput(
      parser,
      jsonFixtures.backslashAtEndInMiddleColumn(),
    );

    expect(csv).toBe(csvFixtures.backslashAtEndInMiddleColumn);
  });

  it("should escape quotes with value in 'escapedQuote'", async () => {
    const opts: ParserOptions = {
      fields: ['a string'],
      formatters: {
        string: stringFormatter({ escapedQuote: '*' }),
      },
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.escapedQuotes());

    expect(csv).toBe(csvFixtures.escapedQuotes);
  });

  it("should escape quotes before new line with value in 'escapedQuote'", async () => {
    const opts: ParserOptions = {
      fields: ['a string'],
      eol: '\n',
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.backslashBeforeNewLine());

    expect(csv).toBe(csvFixtures.backslashBeforeNewLine);
  });

  // String Quote Only if Necessary

  it('should quote only if necessary if using stringQuoteOnlyIfNecessary formatter', async () => {
    const opts: ParserOptions = {
      formatters: {
        string: stringQuoteOnlyIfNecessaryFormatter({ eol: '\n' }),
      },
      eol: '\n',
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.quoteOnlyIfNecessary());

    expect(csv).toBe(csvFixtures.quoteOnlyIfNecessary);
  });

  // String Excel

  it('should format strings to force excel to view the values as strings', async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'color'],
      formatters: {
        string: stringExcelFormatter,
      },
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.excelStrings);
  });

  it('should format strings to force excel to view the values as strings with escaped quotes', async () => {
    const opts: ParserOptions = {
      formatters: {
        string: stringExcelFormatter,
      },
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.quotes());

    expect(csv).toBe(csvFixtures.excelStringsWithEscapedQuoted);
  });

  // String Escaping and preserving values

  it('should parse JSON values with trailing backslashes', async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'color'],
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.trailingBackslash());

    expect(csv).toBe(csvFixtures.trailingBackslash);
  });

  it('should escape " when preceeded by \\', async () => {
    const parser = new Parser();
    const csv = await parseInput(
      parser,
      jsonFixtures.escapeDoubleBackslashedEscapedQuote(),
    );

    expect(csv).toBe(csvFixtures.escapeDoubleBackslashedEscapedQuote);
  });

  it('should preserve new lines in values', async () => {
    const opts: ParserOptions = {
      eol: '\r\n',
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.eol());

    expect(csv).toBe(
      [
        '"a string"',
        '"with a \u2028description\\n and\na new line"',
        '"with a \u2029\u2028description and\r\nanother new line"',
      ].join('\r\n'),
    );
  });

  // Headers

  it('should format headers based on the headers formatter', async () => {
    const opts: ParserOptions = {
      fields: ['carModel', 'price', 'color', 'manual'],
      formatters: {
        header: stringFormatter({ quote: '' }),
      },
    };

    const parser = new Parser(opts);
    const csv = await parseInput(parser, jsonFixtures.default());

    expect(csv).toBe(csvFixtures.customHeaderQuotes);
  });
});
