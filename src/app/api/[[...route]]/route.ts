export async function GET() {
  return Response.json({
    ok: true,
    message: 'API route is available.',
  });
}

export async function POST() {
  return Response.json(
    {
      ok: false,
      message: 'No API handler is configured for this endpoint.',
    },
    { status: 501 },
  );
}
