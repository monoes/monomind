from os import path

class UserService:
    def __init__(self, db):
        self.db = db

    def get_user(self, user_id: str):
        return self.db.find(user_id)

def helper_fn(x: int) -> int:
    return x * 2

def _private_fn(y: int) -> int:
    return y + 1
