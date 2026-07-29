import heroSchoolAdmin from './school_admin.png';
import heroTeacher from './teacher.png';
import heroStudent from './student.png';
import heroParent from './parent.png';
import heroLibrary from './library.png';
import heroDriver from './driver.png';
import heroSuperAdmin from './super_admin.png';
import heroGroupAdmin from './group_admin.png';

export const illustrations = {
    school_admin: heroSchoolAdmin,
    teacher: heroTeacher,
    student: heroStudent,
    parent: heroParent,
    librarian: heroLibrary,
    driver: heroDriver,
    super_admin: heroSuperAdmin,
    group_admin: heroGroupAdmin,
};

export const getIllustration = (role) => {
    return illustrations[role] ?? illustrations['school_admin'];
};

export { heroSchoolAdmin, heroTeacher, heroStudent, heroParent, heroLibrary, heroDriver, heroSuperAdmin, heroGroupAdmin };
export default illustrations;