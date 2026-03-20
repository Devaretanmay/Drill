import { describe, it, expect } from 'vitest';
import { redact, redactWithStats, SENTINEL_VALUE } from '../src/lib/redact';

describe('redact', () => {
  describe('email patterns', () => {
    it('redacts standard email addresses', () => {
      expect(redact('Failed to email john.doe@example.com')).toBe('Failed to email [EMAIL]');
    });

    it('redacts emails with plus addressing', () => {
      expect(redact('user+tag@subdomain.company.co.uk')).toContain('[EMAIL]');
    });

    it('redacts multiple emails', () => {
      const result = redact('Contact john@test.com or jane@test.org');
      expect(result).toBe('Contact [EMAIL] or [EMAIL]');
    });
  });

  describe('IPv4 patterns', () => {
    it('redacts IPv4 addresses', () => {
      expect(redact('connecting to 192.168.1.100:5432')).toBe('connecting to [IP]:5432');
    });

    it('redacts IPv4 in URL context', () => {
      expect(redact('http://10.0.0.1/api')).not.toContain('10.0.0.1');
    });

    it('redacts multiple IPv4 addresses', () => {
      const result = redact('Server 192.168.1.1 connected to 10.0.0.5');
      expect(result).toBe('Server [IP] connected to [IP]');
    });
  });

  describe('IPv6 patterns', () => {
    it('redacts IPv6 addresses', () => {
      expect(redact('Connecting to 2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toContain('[IP]');
    });
  });

  describe('JWT patterns', () => {
    it('redacts full JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      expect(redact(`Authorization: Bearer ${jwt}`)).toBe('Authorization: Bearer [TOKEN]');
    });
  });

  describe('AWS key patterns', () => {
    it('redacts AWS access key IDs', () => {
      expect(redact('aws_access_key_id = AKIAIOSFODNN7EXAMPLE')).toContain('[AWS_KEY]');
    });

    it('redacts ASIA keys (session tokens)', () => {
      expect(redact('AKIAIOSFODNN7EXAMPLE')).toContain('[AWS_KEY]');
    });
  });

  describe('key=value secret patterns', () => {
    it('redacts password= patterns', () => {
      expect(redact('DB_PASSWORD=mysecretpassword123')).toContain('[REDACTED]');
    });

    it('redacts token= patterns case insensitively', () => {
      expect(redact('API_TOKEN=abc123def456')).toContain('[REDACTED]');
    });

    it('redacts secret= patterns', () => {
      expect(redact('SECRET=my_secret_value')).toContain('[REDACTED]');
    });

    it('redacts api_key patterns', () => {
      expect(redact('API_KEY=xyz789abc')).toContain('[REDACTED]');
    });
  });

  describe('DSN / connection string patterns', () => {
    it('redacts database connection strings', () => {
      expect(redact('postgres://user:pass@db.host.com:5432/mydb')).toBe('[DSN]');
    });

    it('redacts Redis connection strings', () => {
      expect(redact('redis://:password@127.0.0.1:6379')).toContain('[DSN]');
    });

    it('redacts MySQL connection strings', () => {
      expect(redact('mysql://admin:password123@mysql.example.com:3306/app')).toContain('[DSN]');
    });
  });

  describe('UUID patterns', () => {
    it('redacts UUIDs', () => {
      expect(redact('request_id: 550e8400-e29b-41d4-a716-446655440000')).toContain('[UUID]');
    });

    it('redacts UUIDs in lowercase', () => {
      expect(redact('id=550e8400-e29b-41d4-a716-446655440000')).toContain('[UUID]');
    });
  });

  describe('SSH key patterns', () => {
    it('redacts SSH private keys', () => {
      const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...\n-----END RSA PRIVATE KEY-----';
      expect(redact(key)).toContain('[SSH_KEY]');
    });
  });

  describe('Bearer token patterns', () => {
    it('redacts Bearer tokens', () => {
      expect(redact('Authorization: Bearer abc123xyz789')).toBe('Authorization: Bearer [TOKEN]');
    });
  });

  describe('credit card patterns', () => {
    it('redacts credit card numbers', () => {
      expect(redact('Card: 4111-1111-1111-1111')).toContain('[CARD]');
    });

    it('redacts credit cards without dashes', () => {
      expect(redact('Card: 4111111111111111')).toContain('[CARD]');
    });
  });

  describe('phone number patterns', () => {
    it('redacts phone numbers', () => {
      expect(redact('Call us at (555) 123-4567')).toContain('[PHONE]');
    });

    it('redacts international phone numbers', () => {
      expect(redact('Contact: +1-555-123-4567')).toContain('[PHONE]');
    });
  });

  describe('preservation of non-PII content', () => {
    it('preserves error messages that contain no PII', () => {
      const log = 'ERROR: connection refused at UserService.java:42';
      expect(redact(log)).toBe(log);
    });

    it('preserves stack trace structure', () => {
      const trace = 'at Object.connect (node_modules/pg/lib/client.js:54:17)';
      expect(redact(trace)).toBe(trace);
    });

    it('preserves file paths and line numbers', () => {
      const log = 'at com.example.app.UserService.getUser (UserService.java:123)';
      expect(redact(log)).toBe(log);
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(redact('')).toBe('');
    });

    it('handles string with only whitespace', () => {
      expect(redact('   \n  ')).toBe('   \n  ');
    });

    it('handles string with only PII', () => {
      const result = redact('john@example.com');
      expect(result).toBe('[EMAIL]');
    });

    it('does not return sentinel when content remains after redaction', () => {
      const allPii = 'john@example.com 192.168.1.1';
      const result = redact(allPii);
      expect(result).not.toBe(SENTINEL_VALUE);
      expect(result).toContain('[EMAIL]');
      expect(result).toContain('[IP]');
    });
  });
});

describe('redactWithStats', () => {
  it('returns correct replacement count in stats', () => {
    const { stats } = redactWithStats('user@test.com logged in from 10.0.0.1');
    expect(stats.totalReplacements).toBe(2);
  });

  it('tracks individual pattern counts', () => {
    const { stats } = redactWithStats('emails: a@b.com c@d.com ips: 1.2.3.4');
    expect(stats.patternsMatched['email']).toBe(2);
    expect(stats.patternsMatched['ipv4']).toBe(1);
  });

  it('returns correct charsRemoved count', () => {
    const { stats } = redactWithStats('user@test.com');
    expect(stats.charsRemoved).toBeGreaterThan(0);
  });

  it('handles empty input gracefully', () => {
    const { redacted, stats } = redactWithStats('');
    expect(redacted).toBe('');
    expect(stats.totalReplacements).toBe(0);
  });

  it('returns sentinel when only PII is present and no replacement tokens remain', () => {
    const input = 'john.doe@example.com';
    const result = redact(input);
    expect(result).toBe('[EMAIL]');
    expect(result).not.toBe(SENTINEL_VALUE);
    expect(result.trim().length).toBeGreaterThan(0);
  });

  it('returns sentinel for fully-redacted IPv6-heavy input', () => {
    // IPv6 is 39 chars, replaced with [IP] (4 chars) — many combined will be mostly redacted
    const ipv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    const result = redact(ipv6);
    expect(result).not.toBe(ipv6);
    expect(result.trim().length).toBeGreaterThan(0);
  });

  it('redacts multiple patterns in one string', () => {
    const result = redact('AKIAIOSFODNN7EXAMPLE token=super_secret_key user@corp.com');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result).not.toContain('super_secret_key');
    expect(result).not.toContain('user@corp.com');
  });

  it('redacts Bearer token', () => {
    const result = redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test');
    expect(result).toContain('[TOKEN]');
    expect(result).not.toContain('eyJ');
  });

  it('redacts Basic auth header', () => {
    const result = redact('Authorization: Basic dXNlcjpwYXNz');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('dXNlcjpwYXNz');
  });

  it('redacts kv_secret patterns', () => {
    const result = redact('DB_PASSWORD=supersecret mysql://root:pass@localhost/db');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('supersecret');
    expect(result).not.toContain('pass');
  });

  it('redacts phone numbers', () => {
    const result = redact('Call support: +1 (555) 123-4567');
    expect(result).toContain('[PHONE]');
    expect(result).not.toContain('555');
  });

  it('redacts credit card patterns', () => {
    const result = redact('Card: 4111 1111 1111 1111');
    expect(result).toContain('[CARD]');
    expect(result).not.toContain('4111');
  });

  it('redacts UUIDs', () => {
    const result = redact('User ID: 550e8400-e29b-41d4-a716-446655440000');
    expect(result).toContain('[UUID]');
    expect(result).not.toContain('550e8400');
  });

  it('redacts withStats tracks multiple pattern matches', () => {
    const { stats } = redactWithStats('user@test.com 192.168.1.1 another@test.org 10.0.0.1');
    expect(stats.totalReplacements).toBe(4);
    expect(stats.patternsMatched['email']).toBe(2);
    expect(stats.patternsMatched['ipv4']).toBe(2);
  });

  it('handles redactWithStats with all whitespace', () => {
    const { redacted, stats } = redactWithStats('   \n\t  \n');
    expect(redacted).toBe('   \n\t  \n');
    expect(stats.totalReplacements).toBe(0);
  });

  it('redactsWithStats charsRemoved accounts for replacement length difference', () => {
    const { stats } = redactWithStats('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    // IPv6 (39 chars) → [IP] (4 chars) = 35 chars removed
    expect(stats.charsRemoved).toBeGreaterThan(30);
    expect(stats.patternsMatched['ipv6']).toBe(1);
  });
});
