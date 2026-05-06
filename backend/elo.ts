// Elo management and ranking logic

// !might change later

export type EloResult = {
    winnerRatingBefore: number
    winnerRatingAfter:  number
    loserRatingBefore:  number
    loserRatingAfter:   number
    winnerChange:       number  // how many points the winner gained
    loserChange:        number  // how many points the loser lost (negative)
}

export function calculateElo(
    winnerRating: number,
    loserRating: number,
    kFactor: number,
): EloResult {
    // Expected score = probability that this player wins given the rating difference
    const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400))
    const expectedLoser  = 1 - expectedWinner

    // Actual score: winner got 1, loser got 0
    const winnerChange = Math.round(kFactor * (1 - expectedWinner))
    const loserChange  = Math.round(kFactor * (0 - expectedLoser))

    return {
        winnerRatingBefore: winnerRating,
        winnerRatingAfter:  Math.max(0, winnerRating + winnerChange), // floor at 0
        loserRatingBefore:  loserRating,
        loserRatingAfter:   Math.max(0, loserRating + loserChange),
        winnerChange,
        loserChange,
    }
}

// Rank tier based on rating: purely cosmetic, used by ui
export function getRankTier(rating: number): string {
    if (rating >= 2000) return 'Netherite'
    if (rating >= 1500) return 'Diamond'
    if (rating >= 1200) return 'Emerald'
    if (rating >= 900) return 'Gold'
    if (rating >= 600) return 'Iron'
    return 'Bronze'
}
