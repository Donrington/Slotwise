export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}
