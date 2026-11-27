import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const maxSchemaBytes = 32 * 1024;

function validatorFor(schema) {
  const serialized = JSON.stringify(schema);
  if (serialized === undefined || Buffer.byteLength(serialized) > maxSchemaBytes) throw new TypeError("Output schema exceeds the size limit.");
  const ajv = new Ajv2020({ strict: true, allErrors: false, validateSchema: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

export function isValidOutputSchema(schema) {
  try {
    validatorFor(schema);
    return true;
  } catch {
    return false;
  }
}

export function validateOutput(value, schema) {
  const validate = validatorFor(schema);
  const valid = validate(value);
  return { valid, path: validate.errors?.[0]?.instancePath || "$", keyword: validate.errors?.[0]?.keyword };
}
