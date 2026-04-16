const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find user
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// Check subscription middleware with expiry validation
const requireSubscription = async (req, res, next) => {
  // Check if subscription is active using the model method
  const isActive = await req.user.isSubscriptionActive();
  
  if (!isActive) {
    return res.status(403).json({ 
      message: 'Premium feature. Please upgrade your subscription.',
      requiresUpgrade: true
    });
  }
  next();
};

// Rate limiting for free users (in-memory, consider Redis for production)
const rateLimitFreeUsers = (maxRequests = 10, windowMs = 60000) => {
  const requests = new Map(); // userId -> { count, resetTime }
  
  return (req, res, next) => {
    if (req.user.subscriptionStatus === 'active') {
      return next();
    }
    
    const now = Date.now();
    const userData = requests.get(req.user.id) || { count: 0, resetTime: now + windowMs };
    
    if (now > userData.resetTime) {
      userData.count = 0;
      userData.resetTime = now + windowMs;
    }
    
    if (userData.count >= maxRequests) {
      return res.status(429).json({ 
        message: `Free tier limit reached. ${maxRequests} analysis requests per minute. Upgrade for unlimited!`
      });
    }
    
    userData.count++;
    requests.set(req.user.id, userData);
    next();
  };
};

module.exports = { authMiddleware, requireSubscription, rateLimitFreeUsers };