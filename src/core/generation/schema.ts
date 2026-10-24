import { z } from 'zod';

/**
 * Model output (HLD §6.1). There is deliberately no field for user text (invariant 2):
 * points are referred to only by ID. Unknown keys are stripped by Zod.
 */
export const SourceSchema = z.object({
  title: z.string().max(500).default(''),
  url: z.string().max(2048),
});

export const AdditionSchema = z.object({
  text: z.string().min(1).max(2000),
  sources: z.array(SourceSchema).max(10).default([]),
});

export const AssignmentSchema = z.object({
  pointIds: z.array(z.string().max(32)).min(1).max(50),
  subtopic: z.object({
    slug: z.string().max(200).default(''),
    title: z.string().min(1).max(120),
    isNew: z.boolean().default(false),
  }),
  explanation: z.string().max(8000).default(''),
  additions: z.array(AdditionSchema).max(10).default([]),
});

/**
 * A model-written note that a point contains a mistake. Holds the model's own explanation
 * and the accurate fact, never a quote or rewrite of the user's point (invariant 2).
 */
export const CorrectionSchema = z.object({
  pointId: z.string().max(32),
  issue: z.string().min(1).max(600),
  correction: z.string().min(1).max(1200),
  sources: z.array(SourceSchema).max(5).default([]),
});

/** The model's accuracy verdict per point. Forces an explicit check before it writes anything else. */
export const ReviewSchema = z.object({
  pointId: z.string().max(32),
  verdict: z.enum(['accurate', 'partly', 'inaccurate']).catch('accurate'),
});

/** A point that repeats an earlier one (from this run or from `knownPoints`). IDs only. */
export const DuplicateSchema = z.object({
  pointId: z.string().max(32),
  duplicateOf: z.string().max(32),
});

export const GenerationOutputSchema = z.object({
  review: z.array(ReviewSchema).max(100).default([]),
  duplicates: z.array(DuplicateSchema).max(100).default([]),
  assignments: z.array(AssignmentSchema).max(100),
  corrections: z.array(CorrectionSchema).max(50).default([]),
});

export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;

/** Digest output (FR-26): a recap grouped into themes. Points by ID only (invariant 2). */
export const DigestOutputSchema = z.object({
  summary: z.string().max(4000).default(''),
  themes: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        pointIds: z.array(z.string().max(32)).max(200).default([]),
        summary: z.string().max(3000).default(''),
      }),
    )
    .max(20),
});
export type DigestOutput = z.infer<typeof DigestOutputSchema>;

/** Note (article) output: sections written from chosen subtopics. Points by ID only (invariant 2). */
export const ArticleOutputSchema = z.object({
  sections: z
    .array(
      z.object({
        heading: z.string().min(1).max(200),
        body: z.string().max(12000).default(''),
        pointIds: z.array(z.string().max(32)).max(200).default([]),
      }),
    )
    .min(1)
    .max(30),
});
export type ArticleOutput = z.infer<typeof ArticleOutputSchema>;

/** The checker's verdict on a note draft. An empty list means it found nothing to fix. */
export const ArticleCheckSchema = z.object({
  issues: z
    .array(
      z.object({
        section: z.number().int().min(0).max(100).default(0),
        problem: z.string().min(1).max(1000),
        fix: z.string().max(2000).default(''),
      }),
    )
    .max(30)
    .default([]),
});
export type ArticleCheck = z.infer<typeof ArticleCheckSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;
export type Correction = z.infer<typeof CorrectionSchema>;

/** JSON Schema handed to providers that support structured output. Mirrors the Zod schema. */
export const GENERATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['review', 'duplicates', 'corrections', 'assignments'],
  properties: {
    review: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pointId', 'verdict'],
        properties: { pointId: { type: 'string' }, verdict: { type: 'string', enum: ['accurate', 'partly', 'inaccurate'] } },
      },
    },
    duplicates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pointId', 'duplicateOf'],
        properties: { pointId: { type: 'string' }, duplicateOf: { type: 'string' } },
      },
    },
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pointId', 'issue', 'correction', 'sources'],
        properties: {
          pointId: { type: 'string' },
          issue: { type: 'string' },
          correction: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'url'],
              properties: { title: { type: 'string' }, url: { type: 'string' } },
            },
          },
        },
      },
    },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pointIds', 'subtopic', 'explanation', 'additions'],
        properties: {
          pointIds: { type: 'array', items: { type: 'string' } },
          subtopic: {
            type: 'object',
            additionalProperties: false,
            required: ['slug', 'title', 'isNew'],
            properties: { slug: { type: 'string' }, title: { type: 'string' }, isNew: { type: 'boolean' } },
          },
          explanation: { type: 'string' },
          additions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'sources'],
              properties: {
                text: { type: 'string' },
                sources: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['title', 'url'],
                    properties: { title: { type: 'string' }, url: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
