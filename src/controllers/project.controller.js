const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendEmail } = require('../utils/emailService');

// Get all projects based on user role
const getAllProjects = async (req, res, next) => {
  try {
    let projects = [];
    const { status, search, sort } = req.query;
    
    // Create filter object
    const filter = {};
    
    // Add status filter if provided
    if (status) {
      filter.status = status.toUpperCase();
    }
    
    // Add search filter if provided
    if (search) {
      filter.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    
    // Create sort object
    let orderBy = { createdAt: 'desc' };
    if (sort) {
      const [field, direction] = sort.split('_');
      if (field && direction) {
        orderBy = { [field]: direction.toLowerCase() };
      }
    }
    
    // If user is a BUYER, get only their projects
    if (req.user.role === 'BUYER') {
      filter.buyerId = req.user.id;
      
      projects = await prisma.project.findMany({
        where: filter,
        orderBy,
        include: {
          buyer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          seller: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          bids: {
            select: {
              id: true,
            },
          },
          files: true,
        },
      });
      
      // Add bid count to each project
      projects = projects.map(project => ({
        ...project,
        bidCount: project.bids.length,
        budget: {
          min: project.budgetMin,
          max: project.budgetMax,
        },
        // Remove unnecessary fields
        budgetMin: undefined,
        budgetMax: undefined,
        bids: undefined,
      }));
    } 
    // If user is a SELLER, get all available projects and projects where they are the selected seller
    else if (req.user.role === 'SELLER') {
      // Get pending projects (available for bidding)
      const pendingProjects = await prisma.project.findMany({
        where: {
          ...filter,
          status: 'PENDING',
        },
        orderBy,
        include: {
          buyer: {
            select: {
              id: true,
              name: true,
            },
          },
          bids: {
            select: {
              id: true,
            },
          },
        },
      });
      
      // Get projects where the seller is selected
      const sellerProjects = await prisma.project.findMany({
        where: {
          sellerId: req.user.id,
        },
        orderBy,
        include: {
          buyer: {
            select: {
              id: true,
              name: true,
            },
          },
          seller: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      
      // Combine and format projects
      projects = [
        ...pendingProjects.map(project => ({
          ...project,
          bidCount: project.bids.length,
          budget: {
            min: project.budgetMin,
            max: project.budgetMax,
          },
          budgetMin: undefined,
          budgetMax: undefined,
          bids: undefined,
        })),
        ...sellerProjects.map(project => ({
          ...project,
          budget: {
            min: project.budgetMin,
            max: project.budgetMax,
          },
          budgetMin: undefined,
          budgetMax: undefined,
        })),
      ];
      
      // Remove duplicates (in case a project appears in both arrays)
      projects = Array.from(new Map(projects.map(p => [p.id, p])).values());
    }
    
    res.status(200).json(projects);
  } catch (error) {
    next(error);
  }
};

// Get project by ID
const getProjectById = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        files: true,
      },
    });
    
    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }
    
    // Format project data
    const formattedProject = {
      ...project,
      budget: {
        min: project.budgetMin,
        max: project.budgetMax,
      },
      budgetMin: undefined,
      budgetMax: undefined,
    };
    
    res.status(200).json(formattedProject);
  } catch (error) {
    next(error);
  }
};

// Create a new project
const createProject = async (req, res, next) => {
  try {
    // Only buyers can create projects
    if (req.user.role !== 'BUYER') {
      const error = new Error('Only buyers can create projects');
      error.statusCode = 403;
      throw error;
    }
    
    const { title, description, budget, deadline } = req.body;
    
    // Validation
    if (!title || !description || !budget || !deadline) {
      const error = new Error('All fields are required');
      error.statusCode = 400;
      throw error;
    }
    
    // Create project
    const project = await prisma.project.create({
      data: {
        title,
        description,
        budgetMin: budget.min,
        budgetMax: budget.max,
        deadline: new Date(deadline),
        status: 'PENDING',
        buyer: {
          connect: { id: req.user.id },
        },
      },
    });
    
    // Format response
    const formattedProject = {
      ...project,
      budget: {
        min: project.budgetMin,
        max: project.budgetMax,
      },
      budgetMin: undefined,
      budgetMax: undefined,
      buyer: {
        id: req.user.id,
        name: req.user.name,
      },
    };
    
    res.status(201).json(formattedProject);
  } catch (error) {
    next(error);
  }
};

// Update a project
const updateProject = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    
    // Verify project exists and user is the owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        buyerId: true,
        status: true,
      },
    });
    
    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }
    
    if (project.buyerId !== req.user.id) {
      const error = new Error('You are not authorized to update this project');
      error.statusCode = 403;
      throw error;
    }
    
    // Only allow updates if project is still pending
    if (project.status !== 'PENDING') {
      const error = new Error('Cannot update a project that is already in progress or completed');
      error.statusCode = 400;
      throw error;
    }
    
    const { title, description, budget, deadline } = req.body;
    
    // Build update data
    const updateData = {};
    
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (budget) {
      updateData.budgetMin = budget.min;
      updateData.budgetMax = budget.max;
    }
    if (deadline) updateData.deadline = new Date(deadline);
    
    // Update project
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: updateData,
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
          },
        },
        seller: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    
    // Format response
    const formattedProject = {
      ...updatedProject,
      budget: {
        min: updatedProject.budgetMin,
        max: updatedProject.budgetMax,
      },
      budgetMin: undefined,
      budgetMax: undefined,
    };
    
    res.status(200).json(formattedProject);
  } catch (error) {
    next(error);
  }
};

// Delete a project
const deleteProject = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    
    // Verify project exists and user is the owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        buyerId: true,
        status: true,
      },
    });
    
    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }
    
    if (project.buyerId !== req.user.id) {
      const error = new Error('You are not authorized to delete this project');
      error.statusCode = 403;
      throw error;
    }
    
    // Only allow deletion if project is still pending
    if (project.status !== 'PENDING') {
      const error = new Error('Cannot delete a project that is already in progress or completed');
      error.statusCode = 400;
      throw error;
    }
    
    // Delete project (this will cascade delete bids and files)
    await prisma.project.delete({
      where: { id: projectId },
    });
    
    res.status(200).json({ message: 'Project deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// Get all bids for a project
const getProjectBids = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    
    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        buyerId: true,
      },
    });
    
    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }
    
    // Only the project owner (buyer) or sellers who have placed bids can view bids
    const isOwner = project.buyerId === req.user.id;
    
    if (!isOwner && req.user.role !== 'SELLER') {
      const error = new Error('You are not authorized to view these bids');
      error.statusCode = 403;
      throw error;
    }
    
    // For sellers who are not the owner, check if they have placed a bid on this project
    if (!isOwner && req.user.role === 'SELLER') {
      const hasBid = await prisma.bid.findFirst({
        where: {
          projectId,
          sellerId: req.user.id,
        },
      });
      
      if (!hasBid) {
        const error = new Error('You are not authorized to view these bids');
        error.statusCode = 403;
        throw error;
      }
    }
    
    // Get all bids for the project
    const bids = await prisma.bid.findMany({
      where: { projectId },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            email: isOwner, // Only include email if the requester is the project owner
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.status(200).json(bids);
  } catch (error) {
    next(error);
  }
};

// Select a bid/seller for a project
const selectBid = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const { bidId, sellerId } = req.body;
    
    if (!bidId || !sellerId) {
      const error = new Error('Bid ID and Seller ID are required');
      error.statusCode = 400;
      throw error;
    }
    
    // Verify project exists and user is the owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        buyerId: true,
        status: true,
        title: true,
      },
    });
    
    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }
    
    if (project.buyerId !== req.user.id) {
      const error = new Error('You are not authorized to select a bid for this project');
      error.statusCode = 403;
      throw error;
    }
    
    // Only allow selection if project is still pending
    if (project.status !== 'PENDING') {
      const error = new Error('Cannot select a bid for a project that is already in progress or completed');
      error.statusCode = 400;
      throw error;
    }
    
    // Verify bid exists and belongs to this project
    const bid = await prisma.bid.findFirst({
      where: {
        id: bidId,
        projectId,
        sellerId,
      },
      include: {
        seller: true,
      },
    });
    
    if (!bid) {
      const error = new Error('Bid not found or does not match the project');
      error.statusCode = 404;
      throw error;
    }
    
    // Update project to mark as in progress and set seller
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'IN_PROGRESS',
        sellerId: sellerId,
      },
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
    
    // Update the selected bid status
    await prisma.bid.update({
      where: { id: bidId },
      data: { status: 'ACCEPTED' },
    });
    
    // Reject all other bids for this project
    await prisma.bid.updateMany({
      where: {
        projectId,
        id: { not: bidId },
      },
      data: { status: 'REJECTED' },
    });
    
    // Send email notification to the selected seller
    if (bid.seller && bid.seller.email) {
      await sendEmail({
        to: bid.seller.email,
        subject: `Your bid for "${project.title}" has been accepted!`,
        text: `Congratulations! Your bid for the project "${project.title}" has been accepted. You can now start working on the project.`,
        html: `
          <h2>Congratulations!</h2>
          <p>Your bid for the project "${project.title}" has been accepted.</p>
          <p>You can now start working on the project.</p>
          <p>Log in to your account to view the project details and communicate with the client.</p>
        `,
      });
    }
    
    // Format response
    const formattedProject = {
      ...updatedProject,
      budget: {
        min: updatedProject.budgetMin,
        max: updatedProject.budgetMax,
      },
      budgetMin: undefined,
      budgetMax: undefined,
    };
    
    res.status(200).json(formattedProject);
  } catch (error) {
    next(error);
  }
};

// Mark project as completed
const completeProject = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    
    // Verify project exists and user is the owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        buyer: true,
        seller: true,
      },
    });
    
    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }
    
    if (project.buyerId !== req.user.id) {
      const error = new Error('Only the project owner can mark it as completed');
      error.statusCode = 403;
      throw error;
    }
    
    // Only allow completion if project is in progress
    if (project.status !== 'IN_PROGRESS') {
      const error = new Error('Only projects that are in progress can be marked as completed');
      error.statusCode = 400;
      throw error;
    }
    
    // Update project to mark as completed
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: { status: 'COMPLETED' },
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
    
    // Send email notifications
    if (project.seller && project.seller.email) {
      await sendEmail({
        to: project.seller.email,
        subject: `Project "${project.title}" has been marked as completed`,
        text: `The project "${project.title}" has been marked as completed by the client. Thank you for your work!`,
        html: `
          <h2>Project Completed</h2>
          <p>The project "${project.title}" has been marked as completed by the client.</p>
          <p>Thank you for your work!</p>
        `,
      });
    }
    
    // Format response
    const formattedProject = {
      ...updatedProject,
      budget: {
        min: updatedProject.budgetMin,
        max: updatedProject.budgetMax,
      },
      budgetMin: undefined,
      budgetMax: undefined,
    };
    
    res.status(200).json(formattedProject);
  } catch (error) {
    next(error);
  }
};

// Upload files to a project
const uploadProjectFiles = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    
    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
      },
    });
    
    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }
    
    // Check if user is authorized (either buyer or assigned seller)
    const isAuthorized = 
      req.user.id === project.buyerId || 
      (project.sellerId && req.user.id === project.sellerId);
    
    if (!isAuthorized) {
      const error = new Error('You are not authorized to upload files to this project');
      error.statusCode = 403;
      throw error;
    }
    
    if (!req.files || req.files.length === 0) {
      const error = new Error('No files uploaded');
      error.statusCode = 400;
      throw error;
    }
    
    // Save file records in the database
    const fileRecords = [];
    
    for (const file of req.files) {
      const fileRecord = await prisma.file.create({
        data: {
          name: file.originalname,
          path: file.path,
          size: file.size,
          mimeType: file.mimetype,
          project: {
            connect: { id: projectId }
          }
        }
      });
      
      fileRecords.push({
        id: fileRecord.id,
        name: fileRecord.name,
        url: `/uploads/${fileRecord.path.split('/').pop()}`,
        size: fileRecord.size,
        mimeType: fileRecord.mimeType,
      });
    }
    
    // Get updated project with files
    const updatedProject = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
          },
        },
        seller: {
          select: {
            id: true,
            name: true,
          },
        },
        files: true,
      },
    });
    
    // Format files for response
    const formattedFiles = updatedProject.files.map(file => ({
      id: file.id,
      name: file.name,
      url: `/uploads/${file.path.split('/').pop()}`,
      size: file.size,
      mimeType: file.mimeType,
    }));
    
    // Format response
    const formattedProject = {
      ...updatedProject,
      budget: {
        min: updatedProject.budgetMin,
        max: updatedProject.budgetMax,
      },
      budgetMin: undefined,
      budgetMax: undefined,
      files: formattedFiles,
    };
    
    res.status(200).json(formattedProject);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectBids,
  selectBid,
  completeProject,
  uploadProjectFiles
};