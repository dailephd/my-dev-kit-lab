pub mod primary;
pub mod secondary;

pub trait Worker { fn operate(&self); }
pub struct Alpha;
pub struct Beta;
impl Worker for Alpha { fn operate(&self) {} }
impl Worker for Beta { fn operate(&self) {} }
impl Alpha { pub fn inspect(&self) {} }
impl Beta { pub fn inspect(&self) {} }
