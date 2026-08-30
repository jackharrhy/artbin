export class OperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function operationErrorResponse(error: unknown): Response {
  if (error instanceof OperationError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof SyntaxError || (error && typeof error === "object" && "issues" in error)) {
    return Response.json(
      { error: { code: "invalid_request", message: "Operation input is invalid" } },
      { status: 400 },
    );
  }
  throw error;
}
