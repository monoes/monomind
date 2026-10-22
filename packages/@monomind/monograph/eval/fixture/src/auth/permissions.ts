export function canAccessResource(userId: string, resourceId: string): boolean {
  return userId.length > 0 && resourceId.length > 0;
}
export function revokeSession(sessionId: string): void {
  void sessionId;
}
