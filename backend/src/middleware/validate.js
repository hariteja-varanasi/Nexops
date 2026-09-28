'use strict';
const ApiError = require('../utils/ApiError');

// Validates req[source] against a zod schema and replaces it with the parsed
// value, so controllers always receive coerced, trusted input.
module.exports = function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        message: i.message,
      }));
      return next(ApiError.badRequest('Check the highlighted fields', details));
    }
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;
    next();
  };
};
