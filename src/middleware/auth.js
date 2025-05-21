const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const error = new Error('Authorization token required');
      error.statusCode = 401;
      throw error;
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true
      }
    });
    
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 401;
      throw error;
    }
    
    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      error.statusCode = 401;
      error.message = 'Invalid token';
    } else if (error.name === 'TokenExpiredError') {
      error.statusCode = 401;
      error.message = 'Token expired';
    }
    
    next(error);
  }
};

/**
 * Middleware to check if user is a buyer
 */
const requireBuyer = (req, res, next) => {
  if (!req.user || req.user.role !== 'BUYER') {
    const error = new Error('Access denied. Buyers only');
    error.statusCode = 403;
    return next(error);
  }
  next();
};

/**
 * Middleware to check if user is a seller
 */
const requireSeller = (req, res, next) => {
  if (!req.user || req.user.role !== 'SELLER') {
    const error = new Error('Access denied. Sellers only');
    error.statusCode = 403;
    return next(error);
  }
  next();
};

/**
 * Middleware to check if user is a project owner
 */
const requireProjectOwner = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { buyerId: true }
    });
    
    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }
    
    if (project.buyerId !== req.user.id) {
      const error = new Error('Access denied. You do not own this project');
      error.statusCode = 403;
      throw error;
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authenticate,
  requireBuyer,
  requireSeller,
  requireProjectOwner
};