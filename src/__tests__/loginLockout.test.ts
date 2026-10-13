import {
  LOCK_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  evaluateLockout,
  nextFailureState
} from '../utils/loginLockout';

const now = new Date('2026-10-13T12:00:00Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

describe('Login lockout rules', () => {
  it('keeps the 5 failures / 15 minutes policy', () => {
    expect(MAX_FAILED_LOGIN_ATTEMPTS).toBe(5);
    expect(LOCK_DURATION_MS).toBe(15 * 60 * 1000);
  });

  describe('evaluateLockout', () => {
    it('is ok without a lock and reports the stored attempts', () => {
      expect(evaluateLockout({ failed_login_attempts: 3, locked_until: null }, now)).toEqual({
        status: 'ok',
        attempts: 3
      });
      expect(evaluateLockout({ failed_login_attempts: null, locked_until: null }, now)).toEqual({
        status: 'ok',
        attempts: 0
      });
    });

    it('is locked while locked_until is in the future', () => {
      const state = evaluateLockout({ failed_login_attempts: 5, locked_until: minutes(10) }, now);
      expect(state).toEqual({ status: 'locked', until: minutes(10) });
    });

    it('accepts locked_until as an ISO string', () => {
      const state = evaluateLockout({ failed_login_attempts: 5, locked_until: minutes(1).toISOString() }, now);
      expect(state.status).toBe('locked');
    });

    it('treats an expired lock as a fresh start (attempts reset to 0)', () => {
      expect(evaluateLockout({ failed_login_attempts: 5, locked_until: minutes(-1) }, now)).toEqual({
        status: 'expired',
        attempts: 0
      });
    });

    it('treats a lock that ends exactly now as expired', () => {
      expect(evaluateLockout({ failed_login_attempts: 5, locked_until: now }, now).status).toBe('expired');
    });
  });

  describe('nextFailureState', () => {
    it('counts failures without locking before the 5th', () => {
      for (let before = 0; before < 4; before += 1) {
        expect(nextFailureState(before, now)).toEqual({
          failed_login_attempts: before + 1,
          locked_until: null
        });
      }
    });

    it('locks for 15 minutes on the 5th failure', () => {
      expect(nextFailureState(4, now)).toEqual({
        failed_login_attempts: 5,
        locked_until: minutes(15)
      });
    });

    it('an expired lock followed by one wrong password counts 1, not 6', () => {
      const expired = evaluateLockout({ failed_login_attempts: 5, locked_until: minutes(-1) }, now);
      expect(expired.status).toBe('expired');
      expect(nextFailureState(expired.status === 'expired' ? expired.attempts : 99, now)).toEqual({
        failed_login_attempts: 1,
        locked_until: null
      });
    });
  });
});
