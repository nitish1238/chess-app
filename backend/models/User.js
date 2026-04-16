const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  subscriptionStatus: {
    type: String,
    enum: ['free', 'active', 'expired', 'cancelled'],
    default: 'free'
  },
  subscriptionType: {
    type: String,
    enum: ['free', 'monthly', 'yearly'],
    default: 'free'
  },
  subscriptionExpiry: {
    type: Date,
    default: null
  },
  stripeCustomerId: {
    type: String,
    default: null
  },
  stats: {
    gamesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    totalAiAnalyses: { type: Number, default: 0 }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if subscription is active
UserSchema.methods.isSubscriptionActive = function() {
  if (this.subscriptionStatus !== 'active') return false;
  if (this.subscriptionExpiry && this.subscriptionExpiry < new Date()) {
    this.subscriptionStatus = 'expired';
    this.save();
    return false;
  }
  return true;
};

module.exports = mongoose.model('User', UserSchema);