const express = require('express');
const router = express.Router();
const {
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectBids,
  selectBid,
  completeProject,
  uploadProjectFiles
} = require('../controllers/project.controller');
const { authenticate, requireBuyer, requireProjectOwner } = require('../middleware/auth');
const { upload } = require('../middleware/fileUpload');

// Protected routes - require authentication
router.use(authenticate);

// Get all projects (filtered based on user role)
router.get('/', getAllProjects);

// Get a specific project
router.get('/:id', getProjectById);

// Create a new project (buyers only)
router.post('/', requireBuyer, createProject);

// Update a project (project owner only)
router.put('/:id', requireProjectOwner, updateProject);

// Delete a project (project owner only)
router.delete('/:id', requireProjectOwner, deleteProject);

// Get all bids for a project
router.get('/:id/bids', getProjectBids);

// Select a bid for a project (project owner only)
router.post('/:id/select-bid', requireProjectOwner, selectBid);

// Mark a project as completed (project owner only)
router.post('/:id/complete', requireProjectOwner, completeProject);

// Upload files to a project
router.post('/:id/files', upload.array('files', 5), uploadProjectFiles);

module.exports = router;