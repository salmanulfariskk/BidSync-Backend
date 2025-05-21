const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendEmail } = require('../utils/emailService');

// Get all bids for the current seller
const getSellerBids = async (req, res, next) => {
  try {
    // Only sellers can access their bids
    if (req.user.role !== 'SELLER') {
      const error = new Error('Only sellers can access their bids');
      error.statusCode = 403;
      throw error;
    }
    
    const bids = await prisma.bid.findMany({
      where: { sellerId: req.user.id },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            status: true,
            deadline: true,
            budgetMin: true,
            budgetMax: true,
            buyerId: true,
            buyer: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    // Format response
    const formattedBids = bids.map(bid => ({
      ...bid,
      project: {
        ...bid.project,
        budget: {
          min: bid.project.budgetMin,
          max: bid.project.budgetMax,
        },
        budgetMin: undefined,
        budgetMax: undefined,
      },
    }));
    
    res.status(200).json(formattedBids);
  } catch (error) {
    next(error);
  }
};

// Create a new bid
const createBid = async (req, res, next) => {
  try {
    // Only sellers can create bids
    if (req.user.role !== 'SELLER') {
      const error = new Error('Only sellers can create bids');
      error.statusCode = 403;
      throw error;
    }
    
    const { projectId, amount, deliveryTime, message } = req.body;
    
    // Validation
    if (!projectId || !amount || !deliveryTime || !message) {
      const error = new Error('All fields are required');
      error.statusCode = 400;
      throw error;
    }
    
    // Verify project exists and is still pending
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        title: true,
        status: true,
        buyerId: true,
        buyer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
    
    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }
    
    if (project.status !== 'PENDING') {
      const error = new Error('Cannot bid on a project that is already in progress or completed');
      error.statusCode = 400;
      throw error;
    }
    
    // Check if seller has already placed a bid on this project
    const existingBid = await prisma.bid.findFirst({
      where: {
        projectId,
        sellerId: req.user.id,
      },
    });
    
    if (existingBid) {
      const error = new Error('You have already placed a bid on this project');
      error.statusCode = 400;
      throw error;
    }
    
    // Create bid
    const bid = await prisma.bid.create({
      data: {
        amount: parseFloat(amount),
        deliveryTime: parseInt(deliveryTime),
        message,
        status: 'PENDING',
        project: {
          connect: { id: projectId }
        },
        seller: {
          connect: { id: req.user.id }
        }
      },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
    
    // Send email notification to the project owner
    if (project.buyer && project.buyer.email) {
      await sendEmail({
        to: project.buyer.email,
        subject: `New bid on your project "${project.title}"`,
        text: `A new bid has been placed on your project "${project.title}". Check it out!`,
        html: `
          <h2>New Bid Received</h2>
          <p>A new bid has been placed on your project "${project.title}".</p>
          <p>Bid Amount: $${amount}</p>
          <p>Delivery Time: ${deliveryTime} days</p>
          <p>Log in to your account to review the bid details.</p>
        `,
      });
    }
    
    res.status(201).json(bid);
  } catch (error) {
    next(error);
  }
};

// Update a bid
const updateBid = async (req, res, next) => {
  try {
    const bidId = req.params.id;
    
    // Verify bid exists and user is the owner
    const bid = await prisma.bid.findUnique({
      where: { id: bidId },
      include: {
        project: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });
    
    if (!bid) {
      const error = new Error('Bid not found');
      error.statusCode = 404;
      throw error;
    }
    
    if (bid.sellerId !== req.user.id) {
      const error = new Error('You are not authorized to update this bid');
      error.statusCode = 403;
      throw error;
    }
    
    // Only allow updates if bid is still pending and project is still pending
    if (bid.status !== 'PENDING' || bid.project.status !== 'PENDING') {
      const error = new Error('Cannot update a bid that has already been accepted or rejected');
      error.statusCode = 400;
      throw error;
    }
    
    const { amount, deliveryTime, message } = req.body;
    
    // Build update data
    const updateData = {};
    
    if (amount) updateData.amount = parseFloat(amount);
    if (deliveryTime) updateData.deliveryTime = parseInt(deliveryTime);
    if (message) updateData.message = message;
    
    // Update bid
    const updatedBid = await prisma.bid.update({
      where: { id: bidId },
      data: updateData,
      include: {
        seller: {
          select: {
            id: true,
            name: true,
          },
        },
        project: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });
    
    res.status(200).json(updatedBid);
  } catch (error) {
    next(error);
  }
};

// Delete a bid
const deleteBid = async (req, res, next) => {
  try {
    const bidId = req.params.id;
    
    // Verify bid exists and user is the owner
    const bid = await prisma.bid.findUnique({
      where: { id: bidId },
      include: {
        project: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });
    
    if (!bid) {
      const error = new Error('Bid not found');
      error.statusCode = 404;
      throw error;
    }
    
    if (bid.sellerId !== req.user.id) {
      const error = new Error('You are not authorized to delete this bid');
      error.statusCode = 403;
      throw error;
    }
    
    // Only allow deletion if bid is still pending and project is still pending
    if (bid.status !== 'PENDING' || bid.project.status !== 'PENDING') {
      const error = new Error('Cannot delete a bid that has already been accepted or rejected');
      error.statusCode = 400;
      throw error;
    }
    
    // Delete bid
    await prisma.bid.delete({
      where: { id: bidId },
    });
    
    res.status(200).json({ message: 'Bid deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// Get a specific bid by ID
const getBidById = async (req, res, next) => {
  try {
    const bidId = req.params.id;
    
    const bid = await prisma.bid.findUnique({
      where: { id: bidId },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        project: {
          select: {
            id: true,
            title: true,
            buyerId: true,
            status: true,
          },
        },
      },
    });
    
    if (!bid) {
      const error = new Error('Bid not found');
      error.statusCode = 404;
      throw error;
    }
    
    // Only the bid owner (seller) or the project owner (buyer) can view the bid
    const isOwner = bid.sellerId === req.user.id;
    const isProjectOwner = bid.project.buyerId === req.user.id;
    
    if (!isOwner && !isProjectOwner) {
      const error = new Error('You are not authorized to view this bid');
      error.statusCode = 403;
      throw error;
    }
    
    res.status(200).json(bid);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSellerBids,
  createBid,
  updateBid,
  deleteBid,
  getBidById
};