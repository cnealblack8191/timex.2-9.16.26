import { useQuery } from "@tanstack/react-query";
import { getMyAccess, type MyAccess } from "@/lib/auth.functions";
import type { Employee } from "@/lib/timekeeping";

export type Access = MyAccess & {
  isAdmin: boolean;
  isPayroll: boolean;
  isViewer: boolean;
  /** True when this person may change time for the given employee. */
  canEdit: (employee?: Pick<Employee, "id" | "division_id"> | null) => boolean;
};

const EMPTY: MyAccess = {
  userId: "",
  email: "",
  displayName: "",
  active: false,
  role: null,
  divisionIds: [],
  employeeIds: [],
};

export function useAccess(): { access: Access; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["my-access"],
    queryFn: () => getMyAccess(),
    staleTime: 60_000,
  });

  const base = data ?? EMPTY;
  const isAdmin = base.role === "admin";
  const isPayroll = base.role === "payroll";

  return {
    isLoading,
    access: {
      ...base,
      isAdmin,
      isPayroll,
      isViewer: base.role === "viewer",
      canEdit: (employee) => {
        if (isAdmin) return true;
        if (!isPayroll || !employee) return false;
        if (base.employeeIds.includes(employee.id)) return true;
        return Boolean(employee.division_id && base.divisionIds.includes(employee.division_id));
      },
    },
  };
}
