export type SocialLink = {
  label?: string | null;
  url: string;
};

export type Tag = {
  id: string;
  name: string;
  color?: string | null;
};

export type PersonCard = {
  id: string;
  birthYear?: number | null;
  birthMonth?: number | null;
  birthDay?: number | null;
  notes?: string | null;
  social: SocialLink[];
  tags: Tag[];
  createdAt?: string;
  updatedAt?: string;
};
