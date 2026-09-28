'use strict';
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const c = require('../controllers');
const S = require('./schemas');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, ROLES } = require('../middleware/auth');
const { registry } = require('../middleware/metrics');

const router = Router();
const h = asyncHandler;

// Brute-force protection on the only unauthenticated write endpoint.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { status: 429, message: 'Too many sign-in attempts. Try again in 15 minutes.' } },
});

// ---------------------------------------------------------------- public
router.get('/health', h(c.health));
router.get('/health/live', c.live);
router.post('/auth/login', loginLimiter, validate(S.login), h(c.login));

// Prometheus scrape target. Left unauthenticated so a ServiceMonitor can reach
// it inside the cluster; restrict with a NetworkPolicy rather than a token.
router.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

// ------------------------------------------------------- authenticated
router.use(authenticate);

router.get('/auth/me', h(c.me));
router.get('/dashboard/stats', h(c.dashboardStats));
router.get('/activity', h(c.listActivity));

// projects
router.get('/projects', h(c.listProjects));
router.post('/projects', authorize(ROLES.DEVELOPER), validate(S.projectCreate), h(c.createProject));
router.get('/projects/:id', validate(S.idParam, 'params'), h(c.getProject));
router.put('/projects/:id', authorize(ROLES.DEVELOPER), validate(S.idParam, 'params'), validate(S.projectUpdate), h(c.updateProject));
router.delete('/projects/:id', authorize(), validate(S.idParam, 'params'), h(c.deleteProject));

// applications
router.get('/applications', h(c.listApplications));
router.post('/applications', authorize(ROLES.DEVELOPER), validate(S.applicationCreate), h(c.createApplication));
router.get('/applications/:id', validate(S.idParam, 'params'), h(c.getApplication));
router.put('/applications/:id', authorize(ROLES.DEVELOPER), validate(S.idParam, 'params'), validate(S.applicationUpdate), h(c.updateApplication));
router.delete('/applications/:id', authorize(), validate(S.idParam, 'params'), h(c.deleteApplication));
router.post('/applications/:id/scale', authorize(ROLES.DEVELOPER), validate(S.idParam, 'params'), validate(S.scale), h(c.scaleApplication));
router.post('/applications/:id/restart', authorize(ROLES.DEVELOPER), validate(S.idParam, 'params'), h(c.restartApplication));
router.post('/applications/:id/rollback', authorize(ROLES.DEVELOPER), validate(S.idParam, 'params'), h(c.rollbackApplication));

// deployments
router.get('/deployments', h(c.listDeployments));
router.get('/deployments/pipeline-stages', c.pipelineStages);
router.post('/deployments', authorize(ROLES.DEVELOPER), validate(S.deploymentCreate), h(c.createDeployment));
router.get('/deployments/:id', validate(S.idParam, 'params'), h(c.getDeployment));
router.put('/deployments/:id/stage', authorize(ROLES.DEVELOPER), validate(S.idParam, 'params'), validate(S.deploymentStage), h(c.updateDeploymentStage));
router.put('/deployments/:id/complete', authorize(ROLES.DEVELOPER), validate(S.idParam, 'params'), validate(S.deploymentComplete), h(c.completeDeployment));

// environments
router.get('/environments', h(c.listEnvironments));
router.get('/environments/:slug', h(c.getEnvironment));

// incidents
router.get('/incidents', h(c.listIncidents));
router.post('/incidents', authorize(ROLES.DEVELOPER, ROLES.VIEWER), validate(S.incidentCreate), h(c.createIncident));
router.get('/incidents/:id', validate(S.idParam, 'params'), h(c.getIncident));
router.put('/incidents/:id', authorize(ROLES.DEVELOPER), validate(S.idParam, 'params'), validate(S.incidentUpdate), h(c.updateIncident));

// monitoring
router.get('/monitoring/overview', h(c.monitoringOverview));
router.get('/monitoring/series/:metric', h(c.monitoringSeries));

// logs
router.get('/logs', validate(S.logQuery, 'query'), h(c.queryLogs));
router.get('/logs/facets', h(c.logFacets));

// users
router.get('/users', h(c.listUsers));
router.post('/users', authorize(), validate(S.userCreate), h(c.createUser));
router.get('/users/:id', validate(S.idParam, 'params'), h(c.getUser));
router.put('/users/:id', authorize(), validate(S.idParam, 'params'), validate(S.userUpdate), h(c.updateUser));
router.delete('/users/:id', authorize(), validate(S.idParam, 'params'), h(c.deleteUser));

module.exports = router;
