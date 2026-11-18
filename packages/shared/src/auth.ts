export type Attendant = {
  id: string;
  username: string;
  displayName: string;
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginResponse = Attendant;
