'use server';
import { ai } from '@/ai/genkit';
import { NextRequest } from 'next/server';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const handler = (req: NextRequest) =>
  ai.handleRequest(req, {
    path: req.nextUrl.pathname.replace('/api', ''),
  });

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;

    