// Validates the JSON Schema subset Shipwright's schemas use. Runtime scripts
// cannot depend on node_modules, so this replaces ajv (which stays a dev-only
// oracle in tests). Unknown keywords throw rather than being silently ignored.

const ANNOTATIONS = ['$schema', '$id', '$comment', 'title', 'description'];
const SUPPORTED = new Set([
  ...ANNOTATIONS,
  'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minItems',
]);

function checkSchema(schema, at) {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) throw new Error(`unsupported schema keyword "${key}" at ${at || '/'}`);
  }
  for (const [name, sub] of Object.entries(schema.properties ?? {})) checkSchema(sub, `${at}/properties/${name}`);
  if (isObject(schema.items)) checkSchema(schema.items, `${at}/items`);
  if (isObject(schema.additionalProperties)) checkSchema(schema.additionalProperties, `${at}/additionalProperties`);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(schema, data, at) {
  const where = at || '/';
  const errors = [];
  const actual = jsonType(data);

  if (schema.type !== undefined) {
    const types = [].concat(schema.type);
    if (!types.some((t) => t === actual || (t === 'number' && actual === 'integer'))) {
      return [`${where}: must be ${types.join(' or ')}`];
    }
  }
  if (schema.const !== undefined && !same(schema.const, data)) errors.push(`${where}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => same(e, data))) {
    errors.push(`${where}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }

  if (actual === 'string') {
    const length = [...data].length;
    if (schema.minLength !== undefined && length < schema.minLength) errors.push(`${where}: must have length >= ${schema.minLength}`);
    if (schema.maxLength !== undefined && length > schema.maxLength) errors.push(`${where}: must have length <= ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data)) errors.push(`${where}: must match ${schema.pattern}`);
  }

  if (actual === 'array') {
    if (schema.minItems !== undefined && data.length < schema.minItems) errors.push(`${where}: must have at least ${schema.minItems} items`);
    if (isObject(schema.items)) data.forEach((item, i) => errors.push(...check(schema.items, item, `${at}/${i}`)));
  }

  if (actual === 'object') {
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(data, name)) errors.push(`${where}: missing required property "${name}"`);
    }
    const props = schema.properties ?? {};
    for (const [name, value] of Object.entries(data)) {
      if (Object.hasOwn(props, name)) errors.push(...check(props[name], value, `${at}/${name}`));
      else if (schema.additionalProperties === false) errors.push(`${at}/${name}: is not allowed`);
      else if (isObject(schema.additionalProperties)) errors.push(...check(schema.additionalProperties, value, `${at}/${name}`));
    }
  }
  return errors;
}

export function validate(schema, data) {
  checkSchema(schema, '');
  return check(schema, data, '');
}
