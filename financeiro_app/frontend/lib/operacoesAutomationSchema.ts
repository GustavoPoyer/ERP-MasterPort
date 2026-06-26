export type AutomationTextField = {
  key: string;
  type: "text";
  label: string;
  placeholder: string;
  required: boolean;
  default_value: string;
};

export type AutomationFileField = {
  key: string;
  type: "file";
  label: string;
  required: boolean;
  multiple: boolean;
  accept: string;
};

export type AutomationFormField = AutomationTextField | AutomationFileField;

export function resolveCardSchema(fields: AutomationFormField[] | undefined | null): AutomationFormField[] {
  return fields?.length ? fields : [];
}

export function slugifyFieldKey(label: string, existing: Set<string>): string {
  let base = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
  if (!base || !/^[a-z]/.test(base)) {
    base = `campo_${existing.size + 1}`;
  }
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function newTextField(existingKeys: Set<string>): AutomationTextField {
  const label = "Campo de texto";
  return {
    key: slugifyFieldKey(label, existingKeys),
    type: "text",
    label,
    placeholder: "",
    required: false,
    default_value: "",
  };
}

export function newFileField(existingKeys: Set<string>): AutomationFileField {
  const label = "Anexar arquivo";
  return {
    key: slugifyFieldKey(label, existingKeys),
    type: "file",
    label,
    required: true,
    multiple: false,
    accept: "",
  };
}
