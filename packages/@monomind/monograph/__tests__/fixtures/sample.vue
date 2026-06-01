<template>
  <div class="user-card">
    <h1>{{ user.name }}</h1>
    <button @click="greet">Greet</button>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';

interface User {
  name: string;
  id: number;
}

class UserService {
  getUser(id: number): User {
    return { id, name: 'Alice' };
  }
}

export default defineComponent({
  name: 'UserCard',
  setup() {
    const user = ref<User>({ name: 'Alice', id: 1 });

    function greet() {
      alert(`Hello, ${user.value.name}`);
    }

    return { user, greet };
  },
});
</script>

<style scoped>
.user-card {
  padding: 1rem;
}
</style>
