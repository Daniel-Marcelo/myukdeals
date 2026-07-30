'use client'

import { createContext, useContext } from 'react'

/**
 * Bumped whenever the user resets dismissed deals or changes blocked retailers.
 *
 * Replaces the old `feedKey` remount trick: now that the shell persists across
 * tabs, forcing a remount would throw away exactly the state we moved the shell
 * to preserve. Feeds subscribe to this token and refetch instead.
 */
export const FeedResetContext = createContext(0)

export const useFeedReset = () => useContext(FeedResetContext)
