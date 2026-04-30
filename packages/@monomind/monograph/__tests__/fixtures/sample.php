<?php
namespace App\Models;

use App\Contracts\UserInterface;
use App\Services\Logger;

interface UserInterface {
  public function getUser(int $id): ?array;
  public function createUser(string $name): bool;
}

class User implements UserInterface {
  private string $name;

  public function __construct(string $name) {
    $this->name = $name;
  }

  public function getUser(int $id): ?array {
    return ['id' => $id, 'name' => $this->name];
  }

  public function createUser(string $name): bool {
    return !empty($name);
  }
}

function helperFn(string $s): string {
  return strtoupper($s);
}
