import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  // Keep file identity separate from its public slug so collisions cannot overwrite entries.
  loader: glob({
    pattern: ['**/*.md', '!**/.*', '!**/.*/**', '!**/~*', '!**/~*/**'],
    base: './src/content/blog', generateId: ({ entry }) => entry,
  }),
  schema: z.object({
    id: z.string().optional(),
    slug: z.string().optional(),
    title: z.string(),
    summary: z.string().optional(),
    description: z.string().optional(),
    categoryId: z.string().min(1).optional(),
    date: z.union([z.string(), z.date()]).optional(),
    pubDate: z.union([z.string(), z.date()]).optional(),
    tags: z.array(z.string()).optional(),
    readTime: z.number().int().positive().optional(),
    demo: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
