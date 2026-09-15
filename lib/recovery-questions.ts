export const RECOVERY_QUESTIONS = [
  {id:'birthday',label:'What is your birthday?'},
  {id:'anniversary',label:'What is an anniversary date you remember?'},
  {id:'wedding',label:'Where did you get married?'},
  {id:'wedding_date',label:'What is your wedding date?'},
  {id:'oldest_child',label:'What is your oldest child’s middle name?'},
  {id:'child_birthday',label:'What is your oldest child’s birthday?'},
  {id:'first_pet',label:'What was your first pet’s name?'},
  {id:'school',label:'What was the name of your first school?'},
  {id:'childhood_street',label:'What street did you grow up on?'},
  {id:'special_place',label:'What is a place with special meaning to you?'}
] as const;
export function normalizeAnswer(answer:string){return answer.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()}
