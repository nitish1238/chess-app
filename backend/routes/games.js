const express = require('express');
const router = express.Router();
const Game = require('../models/Game');
const User = require('../models/User');
const { authMiddleware, requireSubscription, rateLimitFreeUsers } = require('../middleware/auth');

// Get user's game history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const games = await Game.find({
      $or: [
        { whitePlayer: req.user.id },
        { blackPlayer: req.user.id }
      ],
      status: 'completed'
    })
    .populate('whitePlayer', 'username')
    .populate('blackPlayer', 'username')
    .sort({ createdAt: -1 })
    .limit(50);
    
    res.json({ games });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get specific game
router.get('/:gameId', authMiddleware, async (req, res) => {
  try {
    const game = await Game.findOne({ gameId: req.params.gameId })
      .populate('whitePlayer', 'username')
      .populate('blackPlayer', 'username');
    
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }
    
    // Check if user participated
    if (game.whitePlayer._id.toString() !== req.user.id && 
        game.blackPlayer?._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    res.json({ game });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Request AI analysis for a game (premium feature)
router.post('/:gameId/analyze', authMiddleware, requireSubscription, rateLimitFreeUsers(5, 60000), async (req, res) => {
  try {
    const game = await Game.findOne({ gameId: req.params.gameId });
    
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }
    
    // Update user's analysis count
    req.user.stats.totalAiAnalyses += 1;
    await req.user.save();
    
    // Here you would trigger a deep analysis with Stockfish
    // For now, return placeholder
    res.json({ 
      message: 'Analysis started',
      analysisId: Date.now(),
      estimatedTime: '5 seconds'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user stats
router.get('/stats/me', authMiddleware, async (req, res) => {
  try {
    const stats = await Game.aggregate([
      {
        $match: {
          $or: [
            { whitePlayer: req.user._id },
            { blackPlayer: req.user._id }
          ],
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalGames: { $sum: 1 },
          wins: {
            $sum: {
              $cond: [
                { $eq: ['$winner', req.user._id.toString()] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);
    
    const winRate = stats[0]?.totalGames > 0 
      ? ((stats[0].wins / stats[0].totalGames) * 100).toFixed(1)
      : 0;
    
    res.json({
      stats: {
        gamesPlayed: req.user.stats.gamesPlayed,
        wins: req.user.stats.wins,
        losses: req.user.stats.losses,
        draws: req.user.stats.draws,
        winRate: winRate,
        totalAiAnalyses: req.user.stats.totalAiAnalyses
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;