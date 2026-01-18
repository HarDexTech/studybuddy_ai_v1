'use server';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

// This file can be empty or minimal since your AI flows 
// are called directly from your components as server actions
// You don't need special routing here