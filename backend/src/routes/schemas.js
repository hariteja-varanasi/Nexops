'use strict';
const { z } = require('zod');

const id = z.coerce.number().int().positive();

module.exports = {
  idParam: z.object({ id }),

  login: z.object({
    username: z.string().min(1, 'Enter your username'),
    password: z.string().min(1, 'Enter your password'),
  }),

  projectCreate: z.object({
    name: z.string().min(2).max(120),
    description: z.string().max(2000).optional(),
    ownerId: id.optional(),
    repository: z.string().url('Repository must be a full URL').optional().or(z.literal('')),
    environmentId: id.optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  }),
  projectUpdate: z.object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(2000).optional(),
    ownerId: id.optional(),
    repository: z.string().url().optional().or(z.literal('')),
    environmentId: id.optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  }),

  applicationCreate: z.object({
    name: z.string().min(2).max(120).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and dashes (Kubernetes name rules)'),
    projectId: id,
    environmentId: id,
    description: z.string().max(2000).optional(),
    version: z.string().max(40).optional(),
    repository: z.string().url().optional().or(z.literal('')),
    language: z.string().max(40).optional(),
    imageRepository: z.string().max(255).optional(),
    replicas: z.coerce.number().int().min(0).max(20).optional(),
  }),
  applicationUpdate: z.object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(2000).optional(),
    version: z.string().max(40).optional(),
    repository: z.string().url().optional().or(z.literal('')),
    replicas: z.coerce.number().int().min(0).max(20).optional(),
    status: z.enum(['RUNNING', 'STOPPED', 'FAILED', 'PENDING', 'DEPLOYING']).optional(),
    health: z.enum(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN']).optional(),
    imageRepository: z.string().max(255).optional(),
    imageTag: z.string().max(80).optional(),
  }),
  scale: z.object({ replicas: z.coerce.number().int().min(0).max(20) }),

  deploymentCreate: z.object({
    applicationId: id,
    version: z.string().min(1).max(40),
    gitCommit: z.string().max(40).optional(),
    gitBranch: z.string().max(120).optional(),
    buildNumber: z.coerce.number().int().optional(),
    imageTag: z.string().max(120).optional(),
    strategy: z.enum(['ROLLING', 'RECREATE', 'BLUE_GREEN', 'CANARY']).optional(),
    notes: z.string().max(2000).optional(),
  }),
  deploymentStage: z.object({
    stage: z.string().min(1),
    status: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED']),
    durationMs: z.coerce.number().int().min(0).optional(),
  }),
  deploymentComplete: z.object({
    status: z.enum(['SUCCESS', 'FAILED', 'ROLLED_BACK']),
  }),

  incidentCreate: z.object({
    title: z.string().min(4).max(200),
    description: z.string().max(4000).optional(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED']).optional(),
    applicationId: id.optional(),
    environmentId: id.optional(),
    assignedTo: id.optional(),
  }),
  incidentUpdate: z.object({
    title: z.string().min(4).max(200).optional(),
    description: z.string().max(4000).optional(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED']).optional(),
    applicationId: id.optional(),
    assignedTo: id.optional(),
  }),

  userCreate: z.object({
    username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only'),
    email: z.string().email(),
    fullName: z.string().min(2).max(120),
    password: z.string().min(8, 'Use at least 8 characters'),
    role: z.enum(['ADMIN', 'DEVELOPER', 'VIEWER']).optional(),
  }),
  userUpdate: z.object({
    email: z.string().email().optional(),
    fullName: z.string().min(2).max(120).optional(),
    password: z.string().min(8).optional(),
    role: z.enum(['ADMIN', 'DEVELOPER', 'VIEWER']).optional(),
    isActive: z.boolean().optional(),
  }),

  logQuery: z.object({
    app: z.string().optional(),
    namespace: z.string().optional(),
    pod: z.string().optional(),
    level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']).optional(),
    search: z.string().optional(),
    since: z.coerce.number().int().min(1).max(10080).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
  }),
};
