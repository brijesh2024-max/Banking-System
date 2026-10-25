export class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const notFound = (message = 'The requested resource was not found.') => new AppError(404, 'NOT_FOUND', message);

// Only messages created by our own configuration validation are safe to print.
// Database driver messages can contain a connection URI or credentials.
export class ConfigurationError extends Error {}

export function startupErrorMessage(error) {
  if (error instanceof ConfigurationError) return error.message;
  if (error?.code === 18 || error?.codeName === 'AuthenticationFailed') return 'MongoDB authentication failed. Check the database username and password.';
  if (error?.name === 'MongoParseError') return 'The MongoDB connection string is invalid. Check MONGODB_URI.';
  if (['MongoServerSelectionError', 'MongooseServerSelectionError', 'MongoNetworkError'].includes(error?.name)) return 'Could not reach MongoDB. Check the connection address, network access, and Atlas IP access list.';
  return 'Startup could not complete. Check the server configuration and database availability.';
}

export function errorHandler(error, _request, response, _next) {
  if (error instanceof AppError) {
    return response.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } });
  }
  if (error?.type === 'entity.too.large') return response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
  if (error instanceof SyntaxError && error.status === 400) return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Send a valid JSON request body.' } });
  if (error?.name === 'CastError' || error?.name === 'ValidationError') return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'One or more supplied values are invalid.' } });
  if (error?.code === 11000) return response.status(409).json({ error: { code: 'CONFLICT', message: 'This resource already exists.' } });
  console.error('[api] An unexpected request error occurred.');
  return response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}
