'use strict';
const projectService = require('../services/projectService');
const applicationService = require('../services/applicationService');
const deploymentService = require('../services/deploymentService');
const environmentService = require('../services/environmentService');
const incidentService = require('../services/incidentService');
const dashboardService = require('../services/dashboardService');
const monitoringService = require('../services/monitoringService');
const logService = require('../services/logService');
const userService = require('../services/userService');
const healthService = require('../services/healthService');
const auditService = require('../services/auditService');

const q = (req) => req.validatedQuery ?? req.query;

module.exports = {
  // ---- auth ----
  login: async (req, res) => res.json(await userService.login(req.body.username, req.body.password)),
  me: async (req, res) => res.json(await userService.getById(req.user.id)),

  // ---- dashboard ----
  dashboardStats: async (_req, res) => res.json(await dashboardService.stats()),

  // ---- projects ----
  listProjects: async (req, res) => res.json(await projectService.list(q(req))),
  getProject: async (req, res) => res.json(await projectService.getById(req.params.id)),
  createProject: async (req, res) => res.status(201).json(await projectService.create(req.body)),
  updateProject: async (req, res) => res.json(await projectService.update(req.params.id, req.body)),
  deleteProject: async (req, res) => { await projectService.remove(req.params.id); res.status(204).end(); },

  // ---- applications ----
  listApplications: async (req, res) => res.json(await applicationService.list(q(req))),
  getApplication: async (req, res) => res.json(await applicationService.getById(req.params.id)),
  createApplication: async (req, res) => res.status(201).json(await applicationService.create(req.body)),
  updateApplication: async (req, res) => res.json(await applicationService.update(req.params.id, req.body)),
  deleteApplication: async (req, res) => { await applicationService.remove(req.params.id); res.status(204).end(); },
  scaleApplication: async (req, res) => res.json(await applicationService.scale(req.params.id, req.body.replicas, req.user)),
  restartApplication: async (req, res) => res.json(await applicationService.restart(req.params.id, req.user)),
  rollbackApplication: async (req, res) => res.json(await deploymentService.rollback(req.params.id, req.user)),

  // ---- deployments ----
  listDeployments: async (req, res) => res.json(await deploymentService.list(q(req))),
  getDeployment: async (req, res) => res.json(await deploymentService.getById(req.params.id)),
  createDeployment: async (req, res) => res.status(201).json(await deploymentService.create(req.body, req.user)),
  updateDeploymentStage: async (req, res) => res.json(await deploymentService.updateStage(req.params.id, req.body, req.user)),
  completeDeployment: async (req, res) => res.json(await deploymentService.complete(req.params.id, req.body.status, req.user)),
  pipelineStages: (_req, res) => res.json({ stages: deploymentService.PIPELINE_STAGES }),

  // ---- environments ----
  listEnvironments: async (_req, res) => res.json(await environmentService.list()),
  getEnvironment: async (req, res) => res.json(await environmentService.getBySlug(req.params.slug)),

  // ---- incidents ----
  listIncidents: async (req, res) => res.json(await incidentService.list(q(req))),
  getIncident: async (req, res) => res.json(await incidentService.getById(req.params.id)),
  createIncident: async (req, res) => res.status(201).json(await incidentService.create(req.body, req.user)),
  updateIncident: async (req, res) => res.json(await incidentService.update(req.params.id, req.body, req.user)),

  // ---- monitoring ----
  monitoringOverview: async (req, res) =>
    res.json(await monitoringService.overview(Number(req.query.hours) || 6)),
  monitoringSeries: async (req, res) =>
    res.json(await monitoringService.series(req.params.metric, Number(req.query.hours) || 6)),

  // ---- logs ----
  queryLogs: async (req, res) => res.json(await logService.query(q(req))),
  logFacets: async (_req, res) => res.json(await logService.facets()),

  // ---- users ----
  listUsers: async (_req, res) => res.json(await userService.list()),
  getUser: async (req, res) => res.json(await userService.getById(req.params.id)),
  createUser: async (req, res) => res.status(201).json(await userService.create(req.body, req.user)),
  updateUser: async (req, res) => res.json(await userService.update(req.params.id, req.body, req.user)),
  deleteUser: async (req, res) => { await userService.remove(req.params.id, req.user); res.status(204).end(); },

  // ---- activity ----
  listActivity: async (req, res) => res.json(await auditService.recent(Number(req.query.limit) || 25)),

  // ---- health ----
  live: (_req, res) => res.json(healthService.live()),
  health: async (_req, res) => {
    const result = await healthService.ready();
    res.status(result.status === 'UP' ? 200 : 503).json(result);
  },
};
