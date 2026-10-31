// Express 4 does not catch errors thrown in async route handlers.
// This wrapper forwards them to the central error handler instead of crashing.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
