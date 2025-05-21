const express = require('express');
const router = express.Router();
const {
  getSellerBids,
  createBid,
  updateBid,
  deleteBid,
  getBidById
} = require('../controllers/bid.controller');
const { authenticate, requireSeller } = require('../middleware/auth');

// Protected routes - require authentication
router.use(authenticate);

// Get all bids for the current seller (sellers only)
router.get('/seller', requireSeller, getSellerBids);

// Create a new bid (sellers only)
router.post('/', requireSeller, createBid);

// Get a specific bid
router.get('/:id', getBidById);

// Update a bid (bid owner only)
router.put('/:id', requireSeller, updateBid);

// Delete a bid (bid owner only)
router.delete('/:id', requireSeller, deleteBid);

module.exports = router;