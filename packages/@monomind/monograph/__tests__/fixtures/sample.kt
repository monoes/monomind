import com.example.model.User
import com.example.service.Logger

interface UserService {
    fun getUser(id: Int): User?
    fun createUser(name: String): Boolean
}

data class User(val id: Int, val name: String)

class UserServiceImpl : UserService {
    private val users = mutableListOf<User>()

    override fun getUser(id: Int): User? {
        return users.find { it.id == id }
    }

    override fun createUser(name: String): Boolean {
        users.add(User(users.size + 1, name))
        return true
    }

    private fun helperFn(s: String): String {
        return s.uppercase()
    }
}

fun topLevelFn(x: Int): Int {
    return x * 2
}
