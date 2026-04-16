const express = require('express');
const router = express.Router();
const Game = require('../models/Game');
const User = require('../models/User');
const { authMiddleware, requireSubscription, rateLimitFreeUsers } = require('../middleware/auth');
const StockfishEngine = require('../ai/stockfish');

// Initialize Stockfish engine for analysis routes
let stockfishEngine = null;

// Initialize engine on first use
const getEngine = async () => {
  if (!stockfishEngine) {
    stockfishEngine = new StockfishEngine();
    await stockfishEngine.init();
  }
  return stockfishEngine;
};

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

// AI Analysis Route - POST /api/analyze
router.post('/analyze', authMiddleware, rateLimitFreeUsers(5, 60000), async (req, res) => {
  try {
    const { fen, depth = 18 } = req.body;
    
    // Validate FEN input
    if (!fen) {
      return res.status(400).json({ message: 'FEN position is required' });
    }
    
    // Check subscription for depth limit
    const isPremium = req.user.subscriptionStatus === 'active';
    const analysisDepth = isPremium ? Math.min(depth, 24) : Math.min(depth, 12);
    
    // Get Stockfish engine
    const engine = await getEngine();
    
    // Perform full analysis
    const analysis = await engine.getFullAnalysis(fen, analysisDepth);
    
    // Update user's analysis count
    req.user.stats.totalAiAnalyses += 1;
    await req.user.save();
    
    // Return analysis result as JSON
    res.json({
      success: true,
      analysis: {
        fen: analysis.fen,
        bestMove: analysis.bestMove,
        evaluation: analysis.evaluation,
        variation: analysis.variation,
        depth: analysis.depth,
        isPremium: isPremium,
        timestamp: analysis.timestamp
      }
    });
    
  } catch (error) {
    console.error('AI Analysis Error:', error);
    res.status(500).json({ 
      message: 'Failed to analyze position',
      error: error.message 
    });
  }
});

// Request analysis for a saved game
router.post('/:gameId/analyze', authMiddleware, requireSubscription, async (req, res) => {
  try {
    const game = await Game.findOne({ gameId: req.params.gameId });
    
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }
    
    // Check if user participated
    if (game.whitePlayer.toString() !== req.user.id && 
        game.blackPlayer?.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Get engine and analyze the final position or specific FEN
    const engine = await getEngine();
    const fen = req.body.fen || game.fen;
    const analysis = await engine.getFullAnalysis(fen, 20);
    
    // Save analysis to game record
    game.aiAnalysis = analysis;
    await game.save();
    
    res.json({
      success: true,
      analysis: analysis
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